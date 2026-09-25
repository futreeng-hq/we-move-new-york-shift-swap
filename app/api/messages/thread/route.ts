import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { isBlockedBetween } from "@/lib/accessScope";

export async function GET(req: NextRequest) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  const url = new URL(req.url);
  const withUserId = url.searchParams.get("with");
  if (!withUserId) return err("'with' query param required", 400);

  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: user.userId, blockedId: withUserId },
        { blockerId: withUserId, blockedId: user.userId },
      ],
    },
    select: { id: true },
  });
  if (block) return err("Conversation not found", 404);

  const [messages] = await Promise.all([
    prisma.message.findMany({
      where: {
        OR: [
          { fromUserId: user.userId, toUserId: withUserId },
          { fromUserId: withUserId, toUserId: user.userId },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true } },
        swap: { select: { id: true, details: true, category: true } },
      },
    }),
    // Mark received messages as read
    prisma.message.updateMany({
      where: { fromUserId: withUserId, toUserId: user.userId, read: false },
      data: { read: true },
    }),
  ]);

  return ok(messages);
}

// DELETE /api/messages/thread?with=userId  → delete YOUR sent messages in a thread.
// Does NOT delete the other party's messages — that would let one user wipe
// the other's record without consent and erase evidence of harassment.
export async function DELETE(req: NextRequest) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  const url = new URL(req.url);
  const withUserId = url.searchParams.get("with");
  if (!withUserId) return err("'with' query param required", 400);

  // Every sibling path (thread GET, thread read, message read, message DELETE)
  // returns a neutral 404 when a block exists in either direction. This one
  // did not, and its `{ deleted: n }` count disclosed whether a conversation
  // with that user existed at all.
  if (await isBlockedBetween(user.userId, withUserId)) {
    return err("Conversation not found", 404);
  }

  const result = await prisma.message.deleteMany({
    where: {
      fromUserId: user.userId,
      toUserId: withUserId,
    },
  });

  return ok({ deleted: result.count });
}
