import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

// PATCH /api/notifications/:id  → mark one notification as read
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const { id } = await params;

  await prisma.notification.updateMany({
    where: { id, userId: user.userId },
    data: { read: true },
  });

  return ok({});
}

// DELETE /api/notifications/:id  → delete one notification
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const { id } = await params;

  await prisma.notification.deleteMany({ where: { id, userId: user.userId } });

  return ok({ deleted: true });
}
