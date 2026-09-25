import { NextRequest, NextResponse } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_2KB } from "@/lib/parseBody";
import { writeAuditLog } from "@/lib/audit";
import { notifyMany } from "@/lib/notifyUser";

// Disputes queue.
//
// `disputed` was a terminal state: it is reached when the two parties give
// conflicting post-shift answers, the schema comment says "admin resolves", the
// user-facing notification promises "an admin will review it" — and no admin
// route anywhere touched it. Disputes accumulated with no resolution path and
// no reputation consequence for either party, which makes the no-show record
// (the thing the whole trust system rests on) trivially deniable: answer "it
// didn't happen" and the dispute absorbs it forever.

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || !["admin", "subAdmin"].includes(dbUser.role)) return err("Forbidden", 403);

  const disputes = await prisma.swapAgreement.findMany({
    where: { status: "disputed" },
    orderBy: { updatedAt: "asc" }, // oldest first — these are people waiting
    select: {
      id: true,
      swapId: true,
      status: true,
      userAId: true,
      userBId: true,
      userANote: true,
      userBNote: true,
      userAHappened: true,
      userBHappened: true,
      shiftDate: true,
      acceptedAt: true,
      updatedAt: true,
      swap: {
        select: { id: true, details: true, date: true, depotId: true, posterName: true },
      },
    },
  });

  // Names for the queue UI. subAdmins do not see emails anywhere else in the
  // admin surface, so none are selected here either.
  const userIds = [...new Set(disputes.flatMap((d: { userAId: string; userBId: string }) => [d.userAId, d.userBId]))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = Object.fromEntries(
    users.map((u: { id: string; firstName: string; lastName: string }) => [u.id, `${u.firstName} ${u.lastName}`]),
  );

  return ok(
    disputes.map((d: Record<string, unknown> & { userAId: string; userBId: string }) => ({
      ...d,
      userAName: nameById[d.userAId] ?? "Unknown",
      userBName: nameById[d.userBId] ?? "Unknown",
    })),
  );
}

// PATCH — resolve one dispute.
//
// resolution:
//   "happened"     → treat as completed; both parties get a completion credit.
//   "did_not"      → treat as cancelled; the swap reopens. No no-show ding:
//                    a dispute means the facts are unclear, and an admin
//                    deciding it did not happen does not establish who failed.
//   "no_show"      → completed for one party, no-show against the other.
//                    Requires noShowUserId, which must be a participant.
export async function PATCH(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser) return err("User not found", 404);
  // Resolving a dispute writes reputation, which is the record operators are
  // judged on. Full admin only, like every other reputation-affecting action.
  if (dbUser.role !== "admin") return err("Only a full admin can resolve disputes", 403);

  const body = await parseBody(req, BODY_2KB);
  if (body instanceof NextResponse) return body;
  const { agreementId, resolution, noShowUserId, note } = body as {
    agreementId?: string;
    resolution?: string;
    noShowUserId?: string;
    note?: string;
  };

  if (!agreementId) return err("agreementId required", 400);
  if (!resolution || !["happened", "did_not", "no_show"].includes(resolution)) {
    return err("resolution must be one of: happened, did_not, no_show", 400);
  }
  if (note && note.length > 500) return err("Note must be 500 characters or fewer", 400);

  const agreement = await prisma.swapAgreement.findUnique({
    where: { id: agreementId },
    select: { id: true, swapId: true, status: true, userAId: true, userBId: true },
  });
  if (!agreement) return err("Dispute not found", 404);
  if (agreement.status !== "disputed") return err("This agreement is not disputed", 409);

  if (resolution === "no_show") {
    if (!noShowUserId) return err("noShowUserId required for a no_show resolution", 400);
    if (noShowUserId !== agreement.userAId && noShowUserId !== agreement.userBId) {
      return err("noShowUserId must be a participant in this agreement", 400);
    }
  }

  const completedId =
    resolution === "no_show"
      ? noShowUserId === agreement.userAId
        ? agreement.userBId
        : agreement.userAId
      : null;

  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    // Guard on status inside the transaction so two admins resolving the same
    // dispute concurrently cannot both apply reputation.
    const claimed = await tx.swapAgreement.updateMany({
      where: { id: agreement.id, status: "disputed" },
      data: {
        status: resolution === "did_not" ? "cancelled" : "completed",
        ...(resolution !== "did_not" ? { completedAt: new Date() } : {}),
      },
    });
    if (claimed.count === 0) throw new Error("ALREADY_RESOLVED");

    if (resolution === "happened") {
      for (const id of [agreement.userAId, agreement.userBId]) {
        await tx.reputation.upsert({
          where: { userId: id },
          update: { completed: { increment: 1 } },
          create: { userId: id, completed: 1 },
        });
      }
    } else if (resolution === "no_show" && completedId && noShowUserId) {
      await tx.reputation.upsert({
        where: { userId: completedId },
        update: { completed: { increment: 1 } },
        create: { userId: completedId, completed: 1 },
      });
      await tx.reputation.upsert({
        where: { userId: noShowUserId },
        update: { noShow: { increment: 1 } },
        create: { userId: noShowUserId, noShow: 1 },
      });
    } else {
      // did_not — put the shift back on the board so it can still be covered.
      await tx.swap.update({ where: { id: agreement.swapId }, data: { status: "open" } });
    }
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === "ALREADY_RESOLVED") return null;
    throw e;
  });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined;
  writeAuditLog({
    adminId: user.userId,
    action: "dispute_resolved",
    targetId: agreement.id,
    targetType: "agreement",
    detail: [
      `resolution: ${resolution}`,
      resolution === "no_show" ? `no-show: ${noShowUserId}` : null,
      note ? `note: ${note}` : null,
    ].filter(Boolean).join(", "),
    ip,
  });

  // Both parties are told the outcome — a dispute resolved silently is
  // indistinguishable from one still being ignored.
  const outcomeText =
    resolution === "happened"
      ? "An admin reviewed your disputed swap and recorded it as completed for both of you."
      : resolution === "did_not"
        ? "An admin reviewed your disputed swap and recorded that it did not happen. The shift is back on the board, and neither of you was marked as a no-show."
        : "An admin reviewed your disputed swap and recorded a no-show. Check your profile for the updated record.";

  await notifyMany([agreement.userAId, agreement.userBId], {
    category: "agreement",
    title: "Dispute resolved",
    body: outcomeText,
    url: `/swaps/${agreement.swapId}`,
  });

  return ok({ resolved: true, resolution });
}
