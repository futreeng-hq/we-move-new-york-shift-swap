import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_4KB } from "@/lib/parseBody";
import { rateLimit } from "@/lib/rateLimit";

// GET  /api/depots/:code/announcements  → active announcements for this depot
// POST /api/depots/:code/announcements  → create (depotRep/admin only)
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { code } = await params;
  const depot = await prisma.depot.findUnique({ where: { code } });
  if (!depot) return err("Depot not found", 404);

  // Announcement bodies are internal depot communications and carry the
  // author's full name; reading them required only a login, so any account
  // could read every depot's notices.
  const caller = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { depotId: true, role: true },
  });
  if (!caller) return err("User not found", 404);
  if (caller.role !== "admin" && caller.depotId !== depot.id) {
    return err("Depot not found", 404);
  }

  const now = new Date();
  const announcements = await prisma.announcement.findMany({
    where: {
      depotId: depot.id,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    include: { author: { select: { id: true, firstName: true, lastName: true } } },
  });

  return ok(announcements);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  if (!await rateLimit(`announcement:${user.userId}`, 10, 3_600_000)) {
    return err("Rate limit: max 10 announcements per hour", 429);
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser) return err("User not found", 404);
  if (dbUser.role !== "depotRep" && dbUser.role !== "admin") return err("Only depot reps can post announcements", 403);
  // A suspended depotRep could otherwise still push a notice to the whole depot.
  const postActiveErr = checkActive(dbUser);
  if (postActiveErr) return err(postActiveErr, 403);

  const { code } = await params;
  const depot = await prisma.depot.findUnique({ where: { code } });
  if (!depot) return err("Depot not found", 404);

  if (dbUser.role === "depotRep" && dbUser.depotId !== depot.id) {
    return err("You can only post announcements for your own depot", 403);
  }

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { text, pinned, expiresAt } = body as { text: string; pinned?: boolean; expiresAt?: string };

  if (!text?.trim()) return err("Announcement text is required", 400);
  if (text.length > 600) return err("Announcement must be 600 characters or fewer", 400);

  if (expiresAt) {
    const exp = new Date(expiresAt);
    if (isNaN(exp.getTime())) return err("Invalid expiresAt date", 400);
    if (exp <= new Date()) return err("expiresAt must be in the future", 400);
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    if (exp > oneYearFromNow) return err("expiresAt cannot be more than 1 year from now", 400);
  }

  const announcement = await prisma.announcement.create({
    data: {
      depotId: depot.id,
      authorId: user.userId,
      body: text.trim(),
      pinned: pinned === true,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    include: { author: { select: { id: true, firstName: true, lastName: true } } },
  });

  return ok(announcement, 201);
}
