import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitParam = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(Math.max(limitParam, 1), 50);

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.notification.count({
      where: { userId: user.userId, read: false },
    }),
  ]);

  const nextCursor = notifications.length < limit ? null : notifications[notifications.length - 1].id;
  return ok({ notifications, unreadCount, nextCursor });
}

// DELETE /api/notifications  → delete all notifications for the user
export async function DELETE(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const result = await prisma.notification.deleteMany({ where: { userId: user.userId } });

  return ok({ deleted: result.count });
}
