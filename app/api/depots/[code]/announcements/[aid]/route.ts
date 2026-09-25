import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_4KB } from "@/lib/parseBody";

// PATCH /api/depots/:code/announcements/:aid → edit pinned/body/expiresAt
// DELETE /api/depots/:code/announcements/:aid → delete
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string; aid: string }> }) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  const { code, aid } = await params;
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser) return err("User not found", 404);
  if (dbUser.role !== "depotRep" && dbUser.role !== "admin") return err("Forbidden", 403);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const ann = await prisma.announcement.findUnique({ where: { id: aid } });
  if (!ann) return err("Announcement not found", 404);
  // `code` was destructured and never used, so the announcement was resolved
  // by id alone and a depotRep reassigned to another depot kept edit rights
  // over their old depot's announcements.
  const depot = await prisma.depot.findUnique({ where: { code }, select: { id: true } });
  if (!depot || ann.depotId !== depot.id) return err("Announcement not found", 404);
  if (dbUser.role === "depotRep" && ann.authorId !== user.userId) return err("You can only edit your own announcements", 403);
  if (dbUser.role === "depotRep" && dbUser.depotId !== depot.id) {
    return err("You can only manage announcements for your own depot", 403);
  }

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { text, pinned, expiresAt } = body as { text?: string; pinned?: boolean; expiresAt?: string };

  if (expiresAt) {
    const exp = new Date(expiresAt);
    if (isNaN(exp.getTime())) return err("Invalid expiresAt date", 400);
    if (exp <= new Date()) return err("expiresAt must be in the future", 400);
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    if (exp > oneYearFromNow) return err("expiresAt cannot be more than 1 year from now", 400);
  }

  const updated = await prisma.announcement.update({
    where: { id: aid },
    data: {
      ...(text !== undefined && { body: text.trim() }),
      ...(pinned !== undefined && { pinned }),
      ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
    },
    include: { author: { select: { id: true, firstName: true, lastName: true } } },
  });

  return ok(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string; aid: string }> }) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  const { code, aid } = await params;
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser) return err("User not found", 404);
  if (dbUser.role !== "depotRep" && dbUser.role !== "admin") return err("Forbidden", 403);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const ann = await prisma.announcement.findUnique({ where: { id: aid } });
  if (!ann) return err("Announcement not found", 404);
  // Same as PATCH: assert the announcement actually belongs to the depot in
  // the URL, and that a depotRep still belongs to that depot.
  const depot = await prisma.depot.findUnique({ where: { code }, select: { id: true } });
  if (!depot || ann.depotId !== depot.id) return err("Announcement not found", 404);
  if (dbUser.role === "depotRep" && ann.authorId !== user.userId) return err("You can only delete your own announcements", 403);
  if (dbUser.role === "depotRep" && dbUser.depotId !== depot.id) {
    return err("You can only manage announcements for your own depot", 403);
  }

  await prisma.announcement.delete({ where: { id: aid } });
  return ok({ deleted: true });
}
