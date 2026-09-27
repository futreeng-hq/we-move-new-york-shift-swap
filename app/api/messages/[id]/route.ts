import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { id } = await params;

  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return err("Message not found", 404);
  if (message.fromUserId !== user.userId) return err("You can only delete your own messages", 403);

  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: user.userId, blockedId: message.toUserId },
        { blockerId: message.toUserId, blockedId: user.userId },
      ],
    },
    select: { id: true },
  });
  if (block) return err("Message not found", 404);

  await prisma.message.delete({ where: { id } });

  return ok({ deleted: true });
}
