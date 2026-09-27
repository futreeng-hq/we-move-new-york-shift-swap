import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { rateLimit } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { notifyUser, notifyMany } from "@/lib/notifyUser";
import { parseBody, BODY_4KB } from "@/lib/parseBody";
import { assertRowsUpdated, isFinalizedConflict } from "@/lib/agreementGuard";
import { nyToday } from "@/lib/nyDate";
import { checkSwapAccess } from "@/lib/accessScope";

// Trust v2: proposals don't lock the swap. Multiple concurrent pending
// proposals per swap are allowed (from different users — one per user via
// partial unique). The owner accepts one (locks swap + agreement, auto-
// declines siblings) or declines (free). Post-shift, both parties answer
// "did it happen?" — the only source of completed/noShow truth.

/** Latest of the swap's concrete dates, or null (undated vacation swaps). */
function computeShiftDate(swap: { date: Date | null; fromDate: Date | null; toDate: Date | null }): Date | null {
  const times = [swap.date, swap.fromDate, swap.toDate]
    .filter((d): d is Date => d != null)
    .map((d) => d.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

// POST /api/swaps/:id/agreement  → propose a swap (does NOT lock the swap)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { id } = await params;

  // Per-user per-swap: max 3 proposal attempts per hour
  if (!await rateLimit(`agreement:${user.userId}:${id}`, 3, 3_600_000)) {
    return err("Too many agreement attempts on this swap — try again later", 429);
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { email: true, suspendedUntil: true } });
  if (!dbUser) return err("User not found", 404);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const swap = await prisma.swap.findUnique({ where: { id } });
  if (!swap) return err("Swap not found", 404);
  if (swap.status !== "open") return err("This swap is no longer open", 400);
  if (swap.userId === user.userId) return err("Cannot create agreement on your own swap", 400);

  // Depot scoping and the symmetric block check. Blocked or foreign-depot
  // users can still hit this endpoint via stale deep-links, since the
  // browse/get routes only filter them out of list responses. Without the
  // depot half, a user from another depot could create a real agreement on
  // this swap, notify the owner, and expose their own full name to them.
  const denied = await checkSwapAccess(user.userId, swap);
  if (denied) return err(denied.message, denied.status);

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { note } = body as { note?: string };

  let agreement;
  try {
    // No transaction needed: proposing no longer touches the swap row.
    // Duplicate pending proposal from the same user trips the partial unique
    // (swap_agreements_swap_user_pending_key) → P2002 → 409.
    agreement = await prisma.swapAgreement.create({
      data: {
        swapId: id,
        userAId: user.userId,
        userBId: swap.userId,
        status: "pending",
        userANote: note ?? null,
        userAAt: new Date(),
      },
      include: {
        userA: { select: { id: true, firstName: true, lastName: true } },
        userB: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err("You already have a proposal on this swap", 409);
    }
    throw e;
  }

  // Notify the swap poster that someone proposed
  const depotCode = await prisma.depot.findUnique({ where: { id: swap.depotId }, select: { code: true } });
  await notifyUser(swap.userId, {
    category: "agreement",
      title: "New swap proposal",
    body: `${agreement.userA?.firstName ?? "An operator"} proposed a swap — review it`,
    url: `/depot/${depotCode?.code ?? swap.depotId}/swaps/${id}`,
  });

  return ok(agreement, 201);
}

// GET /api/swaps/:id/agreement          → current user's most relevant agreement
// GET /api/swaps/:id/agreement?list=1   → owner only: all agreements on the swap
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { id } = await params;
  const { searchParams } = new URL(req.url);

  if (searchParams.get("list")) {
    const swap = await prisma.swap.findUnique({ where: { id }, select: { userId: true } });
    if (!swap) return err("Swap not found", 404);
    if (swap.userId !== user.userId) return err("Not authorized", 403);
    const agreements = await prisma.swapAgreement.findMany({
      where: { swapId: id },
      orderBy: { createdAt: "desc" },
      include: {
        userA: { select: { id: true, firstName: true, lastName: true } },
        userB: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return ok(agreements);
  }

  // Single-agreement view: prefer the live one (accepted > pending > legacy),
  // then most recent. A proposer sees their own proposal; the owner sees the
  // accepted agreement once one exists.
  const agreements = await prisma.swapAgreement.findMany({
    where: {
      swapId: id,
      OR: [{ userAId: user.userId }, { userBId: user.userId }],
    },
    orderBy: { createdAt: "desc" },
    include: {
      userA: { select: { id: true, firstName: true, lastName: true } },
      userB: { select: { id: true, firstName: true, lastName: true } },
      swap: { select: { id: true, details: true, category: true, posterName: true } },
    },
  });
  if (agreements.length === 0) return err("No agreement found", 404);

  const priority: Record<string, number> = {
    accepted: 0, disputed: 1, pending: 2, userA_confirmed: 3, completed: 4, cancelled: 5, declined: 6,
  };
  // For the owner, "pending" should surface only their view of proposals via
  // ?list=1; the single view still returns the top-priority row so existing
  // participant flows (print, post-shift card) keep working.
  agreements.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
  return ok(agreements[0]);
}

// PATCH /api/swaps/:id/agreement
// Actions: accept (owner), decline (owner), cancel (either party),
// confirm_happened / report_noshow (post-shift, either party),
// confirm (legacy userA_confirmed compat only).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { id } = await params;

  // POST applies checkActive; PATCH did not, so a suspended user holding a
  // live access token could still cancel an accepted agreement or file a
  // no-show against their counterparty.
  const patchUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, suspendedUntil: true },
  });
  if (!patchUser) return err("User not found", 404);
  const patchActiveErr = checkActive(patchUser);
  if (patchActiveErr) return err(patchActiveErr, 403);

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { action, note, agreementId } = body as { action: string; note?: string; agreementId?: string };

  // Resolve the target agreement. agreementId disambiguates when the owner
  // has several pending proposals; otherwise fall back to the caller's live
  // agreement (accepted first, then pending/legacy).
  const agreement = agreementId
    ? await prisma.swapAgreement.findFirst({
        where: {
          id: agreementId,
          swapId: id,
          OR: [{ userAId: user.userId }, { userBId: user.userId }],
        },
      })
    : await prisma.swapAgreement.findFirst({
        where: {
          swapId: id,
          OR: [{ userAId: user.userId }, { userBId: user.userId }],
          status: { in: ["accepted", "pending", "userA_confirmed", "disputed"] },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      });
  if (!agreement) return err("No active agreement found", 404);

  const isUserB = agreement.userBId === user.userId; // swap owner
  const isUserA = agreement.userAId === user.userId; // proposer
  if (!isUserA && !isUserB) return err("Not a participant in this agreement", 403);

  const swap = await prisma.swap.findUnique({ where: { id } });
  if (!swap) return err("Swap not found", 404);
  const depot = await prisma.depot.findUnique({ where: { id: swap.depotId }, select: { code: true } });
  const depotId = depot?.code ?? swap.depotId;
  const swapUrl = `/depot/${depotId}/swaps/${id}`;

  // ── accept: owner locks in one proposal; siblings auto-decline ──────────
  if (action === "accept") {
    if (!isUserB) return err("Only the swap owner can accept a proposal", 403);
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const res = await tx.swapAgreement.updateMany({
          where: { id: agreement.id, status: "pending" },
          data: {
            status: "accepted",
            acceptedAt: new Date(),
            shiftDate: computeShiftDate(swap),
            userBNote: note ?? null,
            userBAt: new Date(),
          },
        });
        assertRowsUpdated(res.count);
        await tx.swap.update({ where: { id }, data: { status: "pending" } });
        // Auto-decline every other pending proposal on this swap.
        const siblings = await tx.swapAgreement.findMany({
          where: { swapId: id, status: "pending", id: { not: agreement.id } },
          select: { id: true, userAId: true },
        });
        if (siblings.length > 0) {
          await tx.swapAgreement.updateMany({
            where: { id: { in: siblings.map((s) => s.id) } },
            data: { status: "declined" },
          });
        }
        const updated = await tx.swapAgreement.findUniqueOrThrow({
          where: { id: agreement.id },
          include: {
            userA: { select: { id: true, firstName: true, lastName: true } },
            userB: { select: { id: true, firstName: true, lastName: true } },
          },
        });
        return { updated, declinedProposers: siblings.map((s) => s.userAId) };
      });
    } catch (e) {
      if (isFinalizedConflict(e)) return err("This proposal is no longer pending", 409);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return err("Another proposal was already accepted for this swap", 409);
      }
      throw e;
    }

    await notifyUser(agreement.userAId, {
      category: "agreement",
      title: "Proposal accepted! 🎉",
      body: "The owner accepted your swap proposal. It's locked in — add it to your calendar from the agreement page.",
      url: swapUrl,
    });
    if (result.declinedProposers.length > 0) {
      await notifyMany(result.declinedProposers, {
        category: "agreement",
      title: "Swap went to someone else",
        body: "The owner went with another proposal — no effect on your reputation. Check the board for more swaps.",
        url: `/depot/${depotId}/swaps`,
      });
    }
    return ok(result.updated);
  }

  // ── decline: owner passes on a proposal; no reputation effect ───────────
  if (action === "decline") {
    if (!isUserB) return err("Only the swap owner can decline a proposal", 403);
    try {
      await prisma.$transaction(async (tx) => {
        const res = await tx.swapAgreement.updateMany({
          where: { id: agreement.id, status: "pending" },
          data: { status: "declined" },
        });
        assertRowsUpdated(res.count);
      });
    } catch (e) {
      if (isFinalizedConflict(e)) return err("This proposal is no longer pending", 409);
      throw e;
    }
    const updated = await prisma.swapAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
    await notifyUser(agreement.userAId, {
      category: "agreement",
      title: "Proposal declined",
      body: "The owner passed on your proposal — no effect on your reputation.",
      url: `/depot/${depotId}/swaps`,
    });
    return ok(updated);
  }

  // ── cancel ───────────────────────────────────────────────────────────────
  // pending: proposer withdraws their own proposal — free, no ding.
  // accepted (or legacy userA_confirmed): a real commitment — ding the
  // canceller, reopen the swap, notify the other party.
  if (action === "cancel") {
    if (agreement.status === "pending") {
      if (!isUserA) return err("Only the proposer can withdraw a pending proposal", 403);
      try {
        await prisma.$transaction(async (tx) => {
          const res = await tx.swapAgreement.updateMany({
            where: { id: agreement.id, status: "pending" },
            data: { status: "cancelled" },
          });
          assertRowsUpdated(res.count);
        });
      } catch (e) {
        if (isFinalizedConflict(e)) return err("This agreement was already finalized", 409);
        throw e;
      }
      const updated = await prisma.swapAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      return ok(updated);
    }

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const res = await tx.swapAgreement.updateMany({
          where: { id: agreement.id, status: { in: ["accepted", "userA_confirmed"] } },
          data: { status: "cancelled" },
        });
        assertRowsUpdated(res.count);
        await tx.swap.update({ where: { id }, data: { status: "open" } });
        // Reputation: ding the user who clicked cancel — they're backing out
        // of an accepted commitment (either side).
        await tx.reputation.upsert({
          where: { userId: user.userId },
          update: { cancelled: { increment: 1 } },
          create: { userId: user.userId, cancelled: 1 },
        });
        return tx.swapAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      });
    } catch (e) {
      if (isFinalizedConflict(e)) return err("This agreement was already finalized", 409);
      throw e;
    }

    const otherUserId = isUserB ? agreement.userAId : agreement.userBId;
    await notifyUser(otherUserId, {
      category: "agreement",
      title: "Agreement cancelled",
      body: "The swap agreement was cancelled. The swap is back on the board.",
      url: swapUrl,
    });
    return ok(updated);
  }

  // ── post-shift: confirm_happened / report_noshow ─────────────────────────
  if (action === "confirm_happened" || action === "report_noshow") {
    return handlePostShift(action, agreement, swap, { isUserA, depotId, swapUrl });
  }

  // ── legacy compat: old two-step confirm for userA_confirmed rows ────────
  if (action === "confirm") {
    if (!(isUserA && agreement.status === "userA_confirmed")) {
      return err("Invalid confirmation state", 400);
    }
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const res = await tx.swapAgreement.updateMany({
          where: { id: agreement.id, status: "userA_confirmed" },
          data: { status: "completed", completedAt: new Date() },
        });
        assertRowsUpdated(res.count);
        await tx.swap.update({ where: { id }, data: { status: "filled" } });
        await Promise.all([
          tx.reputation.upsert({
            where: { userId: agreement.userAId },
            update: { completed: { increment: 1 } },
            create: { userId: agreement.userAId, completed: 1 },
          }),
          tx.reputation.upsert({
            where: { userId: agreement.userBId },
            update: { completed: { increment: 1 } },
            create: { userId: agreement.userBId, completed: 1 },
          }),
        ]);
        return tx.swapAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      });
    } catch (e) {
      if (isFinalizedConflict(e)) return err("This agreement was already finalized", 409);
      throw e;
    }
    await notifyUser(agreement.userBId, {
      category: "agreement",
      title: "Swap agreement completed!",
      body: "Both operators confirmed. Your swap is locked in.",
      url: swapUrl,
    });
    return ok(updated);
  }

  return err("Invalid action", 400);
}

// Post-shift resolution. Both true → completed (+1 completed each, review
// prompts). One true + one false → disputed (admin resolves; no auto-ding).
// Both false → cancelled retroactively, no ding (mutually called off).
// One answer only → stored; the followups cron finalizes after 7 days.
async function handlePostShift(
  action: "confirm_happened" | "report_noshow",
  agreement: { id: string; swapId: string; userAId: string; userBId: string; status: string; userAHappened: boolean | null; userBHappened: boolean | null; shiftDate: Date | null; acceptedAt: Date | null },
  swap: { id: string },
  ctx: { isUserA: boolean; depotId: string; swapUrl: string },
) {
  if (agreement.status !== "accepted") {
    return err("Post-shift confirmation is only available on accepted agreements", 400);
  }
  // Server-side gate: answers only count once the shift is actually behind us
  // (UI gating alone would leave a collusion path — accept + instant mutual
  // confirm to farm completed). Undated vacation swaps open at acceptedAt+30d,
  // mirroring the followups cron.
  const shiftPast = agreement.shiftDate
    ? agreement.shiftDate.getTime() < nyToday().getTime()
    : agreement.acceptedAt
      ? Date.now() > agreement.acceptedAt.getTime() + 30 * 86400_000
      : false;
  if (!shiftPast) return err("The shift hasn't happened yet", 400);
  const myField = ctx.isUserA ? "userAHappened" : "userBHappened";
  if ((ctx.isUserA ? agreement.userAHappened : agreement.userBHappened) != null) {
    return err("You already answered for this swap", 409);
  }
  const myAnswer = action === "confirm_happened";

  const state = { outcome: "waiting" as "waiting" | "completed" | "disputed" | "cancelled" };
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Guarded write: only set my answer if still accepted and my field is
      // still null (double-submit / race with the cron's finalization).
      const res = await tx.swapAgreement.updateMany({
        where: { id: agreement.id, status: "accepted", [myField]: null },
        data: { [myField]: myAnswer },
      });
      assertRowsUpdated(res.count);

      const row = await tx.swapAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      const a = row.userAHappened;
      const b = row.userBHappened;

      if (a != null && b != null) {
        if (a && b) {
          state.outcome = "completed";
          const res2 = await tx.swapAgreement.updateMany({
            where: { id: agreement.id, status: "accepted" },
            data: { status: "completed", completedAt: new Date() },
          });
          assertRowsUpdated(res2.count);
          await tx.swap.update({ where: { id: swap.id }, data: { status: "filled" } });
          await Promise.all([
            tx.reputation.upsert({
              where: { userId: row.userAId },
              update: { completed: { increment: 1 } },
              create: { userId: row.userAId, completed: 1 },
            }),
            tx.reputation.upsert({
              where: { userId: row.userBId },
              update: { completed: { increment: 1 } },
              create: { userId: row.userBId, completed: 1 },
            }),
          ]);
        } else if (!a && !b) {
          state.outcome = "cancelled";
          const res2 = await tx.swapAgreement.updateMany({
            where: { id: agreement.id, status: "accepted" },
            data: { status: "cancelled" },
          });
          assertRowsUpdated(res2.count);
          await tx.swap.update({ where: { id: swap.id }, data: { status: "open" } });
        } else {
          state.outcome = "disputed";
          const res2 = await tx.swapAgreement.updateMany({
            where: { id: agreement.id, status: "accepted" },
            data: { status: "disputed" },
          });
          assertRowsUpdated(res2.count);
          // Swap stays as-is; admin resolves from the disputes queue.
        }
      }
      return tx.swapAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
    });
  } catch (e) {
    if (isFinalizedConflict(e)) return err("This agreement was already finalized", 409);
    throw e;
  }

  const otherUserId = ctx.isUserA ? agreement.userBId : agreement.userAId;
  if (state.outcome === "completed") {
    await notifyMany([agreement.userAId, agreement.userBId], {
      category: "agreement",
      title: "Swap completed! 🎉",
      body: "Both of you confirmed the swap happened. Leave a quick rating to build depot trust.",
      url: ctx.swapUrl,
    });
  } else if (state.outcome === "disputed") {
    await notifyUser(otherUserId, {
      category: "agreement",
      title: "Swap outcome disputed",
      body: "Your answers about this swap don't match. An admin will review it — no reputation change for now.",
      url: ctx.swapUrl,
    });
  } else if (state.outcome === "cancelled") {
    await notifyUser(otherUserId, {
      category: "agreement",
      title: "Swap marked as not happened",
      body: "Both of you said the swap didn't happen. No reputation change.",
      url: ctx.swapUrl,
    });
  } else {
    await notifyUser(otherUserId, {
      category: "agreement",
      title: "Did your swap happen?",
      body: "The other operator answered. Confirm your side to settle the swap.",
      url: ctx.swapUrl,
    });
  }
  return ok(updated);
}
