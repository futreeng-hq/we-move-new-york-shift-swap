import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { notifyUser, notifyMany } from "@/lib/notifyUser";
import { nyToday } from "@/lib/nyDate";
import { assertRowsUpdated } from "@/lib/agreementGuard";
import { pingHeartbeat } from "@/lib/heartbeat";

// GET /api/cron/agreement-followups — daily, 13:00 UTC (≈ 9am ET).
//
// 1. Proposal expiry: pending proposals older than 48h → declined (system).
// 2. Post-shift prompt: accepted agreements past their shift date with
//    unanswered "did it happen?" → nudge the parties who haven't answered.
//    Undated (vacation) agreements prompt at acceptedAt + 30d.
// 3. Non-response finalize (shift 7+ days past, or acceptedAt + 37d when
//    undated): conservative rules — a party who responded is never
//    auto-noShowed.
//    - zero answers  → completed-unverified: NO reputation change for either
//      party (locked decision: silent pairs earn nothing), swap → filled.
//    - one answer    → non-responder +1 noShow; responder earns nothing
//      (verification requires both). Answer yes → completed / swap filled;
//      answer no → cancelled / swap reopened (expire-swaps retires it if the
//      date is past).
// Cron work is unbounded in row count. Without an explicit ceiling the
// function is killed at the platform default mid-loop: partial work, no
// heartbeat ping, and no error recorded anywhere.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return err("Unauthorized", 401);

  try {
    const now = new Date();
    const today = nyToday();
    const cutoff48h = new Date(now.getTime() - 48 * 3600_000);
    const promptUndatedBefore = new Date(now.getTime() - 30 * 86400_000); // acceptedAt + 30d
    const finalizeDatedBefore = new Date(today.getTime() - 7 * 86400_000); // shiftDate 7d past
    const finalizeUndatedBefore = new Date(now.getTime() - 37 * 86400_000); // acceptedAt + 37d

    // ── 1. Proposal expiry ────────────────────────────────────────────────
    const staleProposals = await prisma.swapAgreement.findMany({
      where: { status: "pending", createdAt: { lt: cutoff48h } },
      select: { id: true, userAId: true },
    });
    let proposalsExpired = 0;
    if (staleProposals.length > 0) {
      const res = await prisma.swapAgreement.updateMany({
        where: { id: { in: staleProposals.map((p) => p.id) }, status: "pending" },
        data: { status: "declined" },
      });
      proposalsExpired = res.count;
      await notifyMany([...new Set(staleProposals.map((p) => p.userAId))], {
        category: "agreement",
      title: "Proposal expired",
        body: "Your swap proposal wasn't answered within 48 hours — no effect on your reputation.",
        url: "/depots",
      });
    }

    // ── 2. Post-shift prompts ─────────────────────────────────────────────
    const promptable = await prisma.swapAgreement.findMany({
      where: {
        status: "accepted",
        OR: [
          { shiftDate: { not: null, lt: today } },
          { shiftDate: null, acceptedAt: { lt: promptUndatedBefore } },
        ],
        AND: [{ OR: [{ userAHappened: null }, { userBHappened: null }] }],
      },
      select: {
        id: true, userAId: true, userBId: true,
        userAHappened: true, userBHappened: true,
        swap: { select: { id: true, depotId: true, depot: { select: { code: true } } } },
      },
    });
    let prompted = 0;
    for (const a of promptable) {
      const url = `/depot/${a.swap.depot?.code ?? a.swap.depotId}/swaps/${a.swap.id}`;
      const targets: string[] = [];
      if (a.userAHappened == null) targets.push(a.userAId);
      if (a.userBHappened == null) targets.push(a.userBId);
      await notifyMany(targets, {
        category: "agreement",
      title: "Did your swap happen?",
        body: "Confirm whether the swap happened to settle it and build your reputation.",
        url,
      });
      prompted += targets.length;
    }

    // ── 3. Non-response finalize ──────────────────────────────────────────
    const finalizable = await prisma.swapAgreement.findMany({
      where: {
        status: "accepted",
        OR: [
          { shiftDate: { not: null, lt: finalizeDatedBefore } },
          { shiftDate: null, acceptedAt: { lt: finalizeUndatedBefore } },
        ],
        AND: [{ OR: [{ userAHappened: null }, { userBHappened: null }] }],
      },
      select: {
        id: true, userAId: true, userBId: true,
        userAHappened: true, userBHappened: true,
        swap: { select: { id: true, depotId: true, depot: { select: { code: true } } } },
      },
    });
    let finalized = 0;
    for (const a of finalizable) {
      const answers = [a.userAHappened, a.userBHappened].filter((v) => v != null);
      const url = `/depot/${a.swap.depot?.code ?? a.swap.depotId}/swaps/${a.swap.id}`;

      if (answers.length === 0) {
        // Locked decision: silent pairs earn nothing. Close as completed-
        // unverified with zero reputation writes.
        await prisma.$transaction(async (tx) => {
          const res = await tx.swapAgreement.updateMany({
            where: { id: a.id, status: "accepted" },
            data: { status: "completed", completedAt: new Date() },
          });
          assertRowsUpdated(res.count);
          await tx.swap.update({ where: { id: a.swap.id }, data: { status: "filled" } });
        });
        finalized++;
        continue;
      }

      // Exactly one answer. Conservative rule: noShow is written ONLY when
      // the responding party explicitly reported a no-show.
      // - yes-answer + silence → completed, responder +1 completed, silent
      //   party earns nothing. NO noShow — silence alone never earns a ding.
      // - noshow-report + silence → cancelled, silent party +1 noShow,
      //   responder unaffected.
      const aAnswered = a.userAHappened != null;
      const responderId = aAnswered ? a.userAId : a.userBId;
      const nonResponderId = aAnswered ? a.userBId : a.userAId;
      const answer = answers[0] as boolean;
      await prisma.$transaction(async (tx) => {
        const res = await tx.swapAgreement.updateMany({
          where: { id: a.id, status: "accepted" },
          data: answer
            ? { status: "completed", completedAt: new Date() }
            : { status: "cancelled" },
        });
        assertRowsUpdated(res.count);
        await tx.swap.update({
          where: { id: a.swap.id },
          data: { status: answer ? "filled" : "open" },
        });
        if (answer) {
          await tx.reputation.upsert({
            where: { userId: responderId },
            update: { completed: { increment: 1 } },
            create: { userId: responderId, completed: 1 },
          });
        } else {
          await tx.reputation.upsert({
            where: { userId: nonResponderId },
            update: { noShow: { increment: 1 } },
            create: { userId: nonResponderId, noShow: 1 },
          });
        }
      });
      await notifyUser(nonResponderId, {
        category: "agreement",
      title: "Swap settled without your answer",
        body: "You didn't confirm whether your swap happened within 7 days — it was settled from the other operator's answer.",
        url,
      });
      finalized++;
    }

    await pingHeartbeat("agreement-followups");
    return ok({ proposalsExpired, prompted, finalized });
  } catch (e) {
    // Every handler swallowed its error into a 500, so nothing ever threw,
    // onRequestError never fired, and no Sentry event was created. The only
    // signal was heartbeat silence — and HEARTBEAT_URL_BASE is commented out
    // in .env.example, so a cron failing daily was invisible.
    Sentry.captureException(e, { tags: { cron: "agreement-followups" } });
    return err(`Cron failed: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
