import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { calcScore } from "@/lib/reputation";

export async function GET(req: NextRequest) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  // Hide swaps from operators the current user has blocked, or who blocked them.
  // Symmetric, same as the browse list filter.
  const blocks = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: user.userId },
        { blockedId: user.userId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  const hiddenUserIds = new Set<string>();
  for (const b of blocks) {
    hiddenUserIds.add(b.blockerId === user.userId ? b.blockedId : b.blockerId);
  }

  // Depot-scope the list as well as the save. Rows saved before the caller
  // changed depot — or saved through the gap this route used to have — must not
  // keep returning another depot's swaps and their contact details.
  const caller = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { depotId: true },
  });

  const saved = await prisma.savedSwap.findMany({
    where: {
      userId: user.userId,
      // Hide archived swaps (retired from the board) and blocked-user swaps.
      swap: {
        archivedAt: null,
        depotId: caller?.depotId ?? "__no_depot__",
        ...(hiddenUserIds.size > 0 ? { userId: { notIn: [...hiddenUserIds] } } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      swap: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true, lastActiveAt: true } },
        },
      },
    },
  });

  const swapsList = saved.map(s => s.swap).filter(Boolean);
  const userIds = [...new Set(swapsList.map(s => s.userId))];
  const [reps, reviews] = await Promise.all([
    prisma.reputation.findMany({ where: { userId: { in: userIds } } }),
    prisma.review.findMany({ where: { reviewedId: { in: userIds } }, select: { reviewedId: true, rating: true } }),
  ]);
  const repMap = Object.fromEntries(reps.map(r => [r.userId, r]));
  const reviewMap: Record<string, number[]> = {};
  reviews.forEach(r => { (reviewMap[r.reviewedId] ??= []).push(r.rating); });

  // Mask poster last name in list responses to match the browse list — show
  // "First L." to limit bulk identity extraction by anyone who scrapes the API.
  const maskLastName = (name: string) => {
    const parts = name.trim().split(" ");
    return parts.length < 2 ? name : `${parts[0]} ${parts[parts.length - 1][0]}.`;
  };

  const result = swapsList.map(s => ({
    ...s,
    posterName: s.userId === user.userId ? s.posterName : maskLastName(s.posterName),
    saved: true,
    posterLastActive: s.user?.lastActiveAt ?? null,
    reputation: calcScore({
      completed: repMap[s.userId]?.completed ?? 0,
      cancelled: repMap[s.userId]?.cancelled ?? 0,
      noShow: repMap[s.userId]?.noShow ?? 0,
      reviews: reviewMap[s.userId] ?? [],
    }),
  }));

  return ok(result);
}
