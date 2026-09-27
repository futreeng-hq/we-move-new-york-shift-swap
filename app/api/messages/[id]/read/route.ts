import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const { id } = await params;

  const msg = await prisma.message.findUnique({ where: { id } });
  if (!msg) return err("Message not found", 404);
  if (msg.toUserId !== user.userId) return err("Not authorized", 403);

  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: user.userId, blockedId: msg.fromUserId },
        { blockerId: msg.fromUserId, blockedId: user.userId },
      ],
    },
    select: { id: true },
  });
  if (block) return err("Message not found", 404);

  await prisma.message.update({ where: { id }, data: { read: true } });
  return ok({ message: "Marked as read" });
}
