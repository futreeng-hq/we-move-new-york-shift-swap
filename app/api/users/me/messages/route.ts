import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/apiResponse";

// Returns conversation threads grouped by counterpart user,
// with latest message and unread count per thread.
export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  // Hide threads with operators the current user has blocked, or who blocked them.
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

  const allMessages = await prisma.message.findMany({
    where: {
      OR: [{ fromUserId: user.userId }, { toUserId: user.userId }],
      ...(hiddenUserIds.size > 0
        ? {
            AND: [
              { fromUserId: { notIn: [...hiddenUserIds] } },
              { toUserId: { notIn: [...hiddenUserIds] } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      fromUser: { select: { id: true, firstName: true, lastName: true } },
      toUser: { select: { id: true, firstName: true, lastName: true } },
      swap: { select: { id: true, details: true, category: true } },
    },
  });

  // Build map keyed by counterpart userId — first entry per counterpart is the latest
  const convMap = new Map<string, {
    counterpartId: string;
    counterpart: { id: string; firstName: string; lastName: string };
    latestMessage: typeof allMessages[0];
    unreadCount: number;
  }>();

  for (const msg of allMessages) {
    const isReceived = msg.toUserId === user.userId;
    const counterpartId = isReceived ? msg.fromUserId : msg.toUserId;
    const counterpart = (isReceived ? msg.fromUser : msg.toUser) as { id: string; firstName: string; lastName: string };

    if (!convMap.has(counterpartId)) {
      convMap.set(counterpartId, { counterpartId, counterpart, latestMessage: msg, unreadCount: 0 });
    }
    if (isReceived && !msg.read) {
      convMap.get(counterpartId)!.unreadCount++;
    }
  }

  return ok([...convMap.values()]);
}
