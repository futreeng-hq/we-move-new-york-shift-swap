import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_4KB } from "@/lib/parseBody";
import { getPrefs, validatePrefsUpdate } from "@/lib/notificationPrefs";
import { Prisma } from "@prisma/client";

// GET /api/users/me/notification-prefs → merged prefs + quiet hours
export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const settings = await getPrefs(user.userId);
  return ok(settings);
}

// PUT /api/users/me/notification-prefs → validated partial update.
// prefs stay sparse in storage: the update merges over what's already stored
// (NOT over defaults), so unset keys keep tracking future default changes.
export async function PUT(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  if (!await rateLimit(`notifprefs:${user.userId}`, 20, 3_600_000)) {
    return err("Rate limit: too many preference updates", 429);
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, suspendedUntil: true, notificationPrefs: true },
  });
  if (!dbUser) return err("User not found", 404);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;

  const { update, error } = validatePrefsUpdate(body);
  if (error || !update) return err(error ?? "Invalid payload", 400);

  const data: Prisma.UserUpdateInput = {};
  if (update.prefs) {
    const stored =
      dbUser.notificationPrefs && typeof dbUser.notificationPrefs === "object" && !Array.isArray(dbUser.notificationPrefs)
        ? (dbUser.notificationPrefs as Record<string, unknown>)
        : {};
    data.notificationPrefs = { ...stored, ...update.prefs };
  }
  if (update.quietStart !== undefined) {
    data.quietStart = update.quietStart;
    data.quietEnd = update.quietEnd ?? null;
  }

  await prisma.user.update({ where: { id: user.userId }, data });
  const settings = await getPrefs(user.userId);
  return ok(settings);
}
