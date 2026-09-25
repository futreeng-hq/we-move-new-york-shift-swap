import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const { id: blockedId } = await params;
  if (blockedId === user.userId) return err("Cannot block yourself", 400);

  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) return err("User not found", 404);

  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: user.userId, blockedId } },
    create: { id: crypto.randomUUID(), blockerId: user.userId, blockedId },
    update: {},
  });

  await prisma.auditLog.create({
    data: { id: crypto.randomUUID(), adminId: user.userId, action: "block_user", targetId: blockedId, targetType: "user" },
  });

  return ok({ blocked: true });
}
