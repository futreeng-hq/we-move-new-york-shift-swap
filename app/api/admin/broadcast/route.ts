import { NextRequest, NextResponse } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { notifyUser, notifyMany } from "@/lib/notifyUser";
import { parseBody, BODY_4KB } from "@/lib/parseBody";

// POST /api/admin/broadcast
// body: { target: "all" | "user" | "depot", userId?: string, depotCode?: string, text: string }
export async function POST(req: NextRequest) {
  let token;
  try { token = await requireUser(req); } catch (e) { return authError(e); }

  const admin = await prisma.user.findUnique({ where: { id: token.userId } });
  if (!admin || !["admin", "subAdmin"].includes(admin.role)) return err("Forbidden", 403);

  const isSubAdmin = admin.role === "subAdmin";

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { target, userId, depotCode, text } = body as { target: string; userId?: string; depotCode?: string; text: string };

  if (!text?.trim()) return err("Message text required", 400);
  if (text.trim().length > 1000) return err("Max 1000 characters", 400);
  if (!["all", "user", "depot"].includes(target)) return err("Invalid target", 400);
  if (isSubAdmin && target === "all") return err("SubAdmins cannot broadcast to all users", 403);

  const trimmed = text.trim();

  if (target === "user") {
    if (!userId) return err("userId required for user target", 400);
    const recipient = await prisma.user.findUnique({ where: { id: userId } });
    if (!recipient) return err("User not found", 404);
    if (userId === token.userId) return err("Cannot message yourself", 400);

    await prisma.message.create({
      data: { fromUserId: token.userId, toUserId: userId, text: trimmed, swapId: null },
    });
    await notifyUser(userId, {
      category: "announcements",
      title: "Message from Admin",
      body: trimmed.substring(0, 80),
      url: "/inbox",
    });
    return ok({ sent: 1 });
  }

  if (target === "depot") {
    if (!depotCode) return err("depotCode required for depot target", 400);
    const depot = await prisma.depot.findUnique({ where: { code: depotCode } });
    if (!depot) return err("Depot not found", 404);

    const recipients = await prisma.user.findMany({
      where: { depotId: depot.id, id: { not: token.userId } },
      select: { id: true },
    });
    if (!recipients.length) return ok({ sent: 0 });

    const recipientIds = recipients.map(r => r.id);
    await prisma.message.createMany({
      data: recipientIds.map(toUserId => ({
        fromUserId: token.userId, toUserId, text: trimmed, swapId: null,
      })),
    });
    await notifyMany(recipientIds, {
      category: "announcements",
      title: "Message from Admin",
      body: trimmed.substring(0, 80),
      url: "/inbox",
    });
    return ok({ sent: recipientIds.length });
  }

  // target === "all"
  const allUsers = await prisma.user.findMany({
    where: { id: { not: token.userId } },
    select: { id: true },
  });
  if (!allUsers.length) return ok({ sent: 0 });

  const allIds = allUsers.map(u => u.id);
  await prisma.message.createMany({
    data: allIds.map(toUserId => ({
      fromUserId: token.userId, toUserId, text: trimmed, swapId: null,
    })),
  });
  await notifyMany(allIds, {
    category: "announcements",
      title: "Message from Admin",
    body: trimmed.substring(0, 80),
    url: "/inbox",
  });
  return ok({ sent: allIds.length });
}
