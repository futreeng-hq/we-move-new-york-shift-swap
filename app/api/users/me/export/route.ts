import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { err } from "@/lib/apiResponse";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  if (!await rateLimit(`export:${user.userId}`, 3, 3_600_000)) {
    return err("Export rate limit exceeded — max 3 exports per hour", 429);
  }

  const [profile, swaps, messages, agreements, savedSwaps, notifications, reputation, reviews] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, language: true, createdAt: true, depotId: true },
    }),
    prisma.swap.findMany({
      where: { userId: user.userId },
      select: { id: true, category: true, status: true, details: true, date: true, run: true, route: true, createdAt: true },
    }),
    prisma.message.findMany({
      where: { OR: [{ fromUserId: user.userId }, { toUserId: user.userId }] },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { id: true, text: true, createdAt: true, fromUserId: true, toUserId: true },
    }),
    prisma.swapAgreement.findMany({
      where: { OR: [{ userAId: user.userId }, { userBId: user.userId }] },
      select: { id: true, swapId: true, status: true, createdAt: true, completedAt: true },
    }),
    prisma.savedSwap.findMany({
      where: { userId: user.userId },
      select: { swapId: true, createdAt: true },
    }),
    prisma.notification.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, type: true, title: true, body: true, read: true, createdAt: true },
    }),
    prisma.reputation.findUnique({
      where: { userId: user.userId },
      select: { completed: true, cancelled: true, noShow: true },
    }),
    prisma.review.findMany({
      where: { OR: [{ reviewerId: user.userId }, { reviewedId: user.userId }] },
      select: { id: true, swapId: true, rating: true, createdAt: true, reviewerId: true, reviewedId: true },
    }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    profile,
    reputation: reputation ?? { completed: 0, cancelled: 0, noShow: 0 },
    swaps,
    agreements,
    savedSwaps,
    messages,
    notifications,
    reviews,
  };

  const date = new Date().toISOString().split("T")[0];
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="wmny-shift-swap-export-${date}.json"`,
    },
  });
}
