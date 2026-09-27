import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/apiResponse";

// Returns all swaps the user is involved in (any status, sorted newest first):
//   - swaps the user posted (the user is the swap's userId)
//   - swaps the user agreed to (the user is userAId on a SwapAgreement,
//     i.e. they took someone else's posted swap)
//
// Each row is tagged with `myRole` = "posted" | "agreed" so the UI can
// distinguish and tab between the two. A user can be both poster and agreer
// across different swaps; for any single swap they can only be one or the
// other (the swap's poster never proposes their own agreement).
export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  // 1. Swaps posted by the user
  const postedSwaps = await prisma.swap.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: "desc" },
    include: {
      agreements: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        include: {
          userA: { select: { id: true, firstName: true, lastName: true } },
          userB: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  // 2. Swaps the user agreed to (where they're userA on the agreement).
  //    Pull the swaps directly so we get the same shape as posted swaps,
  //    then tag with the same agreements include for symmetry.
  const agreedAgreements = await prisma.swapAgreement.findMany({
    where: { userAId: user.userId },
    orderBy: { createdAt: "desc" },
    select: { swapId: true },
  });
  const agreedSwapIds = agreedAgreements.map(a => a.swapId);
  const agreedSwaps = agreedSwapIds.length > 0
    ? await prisma.swap.findMany({
        where: { id: { in: agreedSwapIds } },
        include: {
          agreements: {
            where: { userAId: user.userId },
            orderBy: { createdAt: "desc" as const },
            take: 1,
            include: {
              userA: { select: { id: true, firstName: true, lastName: true } },
              userB: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : [];

  // Tag each row, then sort the combined list by most recent (createdAt
  // for posted, agreement.createdAt for agreed).
  const posted = postedSwaps.map(s => ({ ...s, myRole: "posted" as const }));
  const agreed = agreedSwaps.map(s => ({ ...s, myRole: "agreed" as const }));

  const all = [...posted, ...agreed].sort((a, b) => {
    const aDate = a.myRole === "agreed" && a.agreements[0]
      ? new Date(a.agreements[0].createdAt).getTime()
      : new Date(a.createdAt).getTime();
    const bDate = b.myRole === "agreed" && b.agreements[0]
      ? new Date(b.agreements[0].createdAt).getTime()
      : new Date(b.createdAt).getTime();
    return bDate - aDate;
  });

  return ok(all);
}
