import { NextRequest, NextResponse } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_1KB } from "@/lib/parseBody";

// POST /api/notifications/mark-read-by-url
//
// Body: { url?: string, urlPrefix?: string }
//
// Marks the current user's unread notifications as read where:
//   - url matches exactly (if `url` provided), OR
//   - url starts with the given prefix (if `urlPrefix` provided)
//
// Used when a user opens a destination that has pending notifications
// pointing at it — for example, opening a message thread should clear the
// bell badge for any "New message from X" notifications about that thread.
//
// Only ONE of url / urlPrefix should be supplied per request. If both are
// passed, urlPrefix takes precedence (it's the more general match).
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const body = await parseBody(req, BODY_1KB);
  if (body instanceof NextResponse) return body;
  const { url, urlPrefix } = body as { url?: string; urlPrefix?: string };

  // Validate: must supply at least one, must be a relative path matching the
  // same shape we accept when CREATING notifications (see lib/notifyUser.ts).
  // This prevents callers from passing arbitrary external URLs and clearing
  // notifications they shouldn't be able to.
  const target = urlPrefix ?? url;
  if (!target || typeof target !== "string") return err("url or urlPrefix required", 400);
  if (!target.startsWith("/")) return err("Path must be relative (start with /)", 400);
  if (target.length > 500) return err("Path too long", 400);

  const where = urlPrefix
    ? { userId: user.userId, read: false, url: { startsWith: urlPrefix } }
    : { userId: user.userId, read: false, url };

  const result = await prisma.notification.updateMany({
    where,
    data: { read: true },
  });

  return ok({ updated: result.count });
}
