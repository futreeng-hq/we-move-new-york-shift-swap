import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { notifyMany } from "@/lib/notifyUser";
import { parseBody, BODY_1KB } from "@/lib/parseBody";
import { assertRowsUpdated, isFinalizedConflict, AGREEMENT_FINALIZED } from "@/lib/agreementGuard";

const VALID = ["open", "pending", "filled", "expired"] as const;
type Status = (typeof VALID)[number];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const { id } = await params;
  const body = await parseBody(req, BODY_1KB);
  if (body instanceof NextResponse) return body;
  const { status } = body as { status: string };

  if (!VALID.includes(status as Status)) return err("Invalid status", 400);

  // Suspension must hold on every write path, not just at login — a suspended
  // owner holding a live access token could otherwise still flip swap status.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, suspendedUntil: true },
  });
  if (!dbUser) return err("User not found", 404);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const swap = await prisma.swap.findUnique({ where: { id } });
  if (!swap) return err("Swap not found", 404);
  if (swap.userId !== user.userId) return err("Not authorized", 403);

  // Trust v2: an accepted agreement is a live commitment — the owner can't
  // silently reopen the swap around it. Cancel the agreement first (which
  // reopens the swap and applies the cancellation ding).
  if (status === "open") {
    const accepted = await prisma.swapAgreement.findFirst({
      where: { swapId: id, status: { in: ["accepted", "userA_confirmed"] } },
      select: { id: true },
    });
    if (accepted) return err("Cancel the agreement first — this swap has an accepted agreement", 409);
  }

  // Guarded transition. The reads above (swap row, accepted-agreement probe)
  // are only advisory — an agreement PATCH can commit between them and the
  // write below. Every agreement transition also writes swap.status (accept →
  // pending, cancel → open, complete → filled), so a compare-and-set pinned to
  // the status we observed is sufficient to detect any interleaved change.
  // CAS rather than read-inside-transaction: at Postgres READ COMMITTED a
  // re-read in the transaction does not block a concurrent writer, whereas
  // updateMany takes a row lock and re-evaluates its WHERE after acquiring it.
  try {
    await prisma.$transaction(async (tx) => {
      // Re-check the accepted-agreement guard under the same transaction.
      if (status === "open") {
        const accepted = await tx.swapAgreement.findFirst({
          where: { swapId: id, status: { in: ["accepted", "userA_confirmed"] } },
          select: { id: true },
        });
        if (accepted) throw Object.assign(new Error("CONFLICT"), { code: AGREEMENT_FINALIZED });
      }
      const res = await tx.swap.updateMany({
        where: { id, status: swap.status },
        data: { status: status as Status },
      });
      assertRowsUpdated(res.count);
    });
  } catch (e) {
    if (isFinalizedConflict(e)) {
      return err("This swap changed while you were editing it — reload and try again", 409);
    }
    throw e;
  }

  const updated = await prisma.swap.findUniqueOrThrow({ where: { id } });

  if (status === "filled") {
    // Trust v2: manual fill closes the swap but grants NO reputation.
    // Reputation flows only from post-shift-confirmed agreements — the manual
    // path was farmable (post → self-fill → +1 completed, repeat).

    // Notify everyone with a stake in this swap: anyone who messaged about it,
    // anyone who saved it, and anyone who proposed an agreement on it.
    // Dedupe across sources, exclude the swap owner.
    // Sent only after the transition commits — previously these fired before
    // the write, so a failed or lost-race update still notified everyone.
    const [messagers, savers, agreementParticipants] = await Promise.all([
      prisma.message.findMany({
        where: { swapId: id, fromUserId: { not: swap.userId } },
        select: { fromUserId: true },
        distinct: ["fromUserId"],
      }),
      prisma.savedSwap.findMany({
        where: { swapId: id, userId: { not: swap.userId } },
        select: { userId: true },
      }),
      prisma.swapAgreement.findMany({
        where: { swapId: id, userAId: { not: swap.userId } },
        select: { userAId: true },
        distinct: ["userAId"],
      }),
    ]);
    const ids = [...new Set([
      ...messagers.map(m => m.fromUserId),
      ...savers.map(s => s.userId),
      ...agreementParticipants.map(a => a.userAId),
    ])];
    if (ids.length > 0) {
      await notifyMany(ids, {
        category: "swap_updates",
      title: "Swap has been filled",
        body: `A swap you were interested in has been filled — check the board for new ones`,
        url: `/depot/${swap.depotId}/swaps`,
      });
    }
  }

  return ok(updated);
}
