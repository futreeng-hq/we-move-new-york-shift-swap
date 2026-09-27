import { NextRequest, NextResponse } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_1KB } from "@/lib/parseBody";

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const body = await parseBody(req, BODY_1KB);
  if (body instanceof NextResponse) return body;
  const { with: counterpartId } = body as { with: string };
  if (!counterpartId) return err("counterpartId required", 400);

  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: user.userId, blockedId: counterpartId },
        { blockerId: counterpartId, blockedId: user.userId },
      ],
    },
    select: { id: true },
  });
  if (block) return err("Conversation not found", 404);

  await prisma.message.updateMany({
    where: { fromUserId: counterpartId, toUserId: user.userId, read: false },
    data: { read: true },
  });
  return ok({ ok: true });
}
