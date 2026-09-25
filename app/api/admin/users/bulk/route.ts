import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { writeAuditLog } from "@/lib/audit";
import { parseBody, BODY_4KB } from "@/lib/parseBody";
import { blockUserAccessTokens } from "@/lib/tokenBlocklist";

// POST /api/admin/users/bulk
// Atomically update role or suspendedUntil for up to 50 users at once.
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || dbUser.role !== "admin") return err("Forbidden", 403);

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { userIds, role, suspendedUntil } = body as {
    userIds: string[];
    role?: string;
    suspendedUntil?: string | null;
  };

  if (!Array.isArray(userIds) || userIds.length === 0) return err("userIds array required", 400);
  if (userIds.length > 50) return err("Maximum 50 users per bulk operation", 400);
  if (userIds.includes(user.userId)) return err("Cannot bulk-update your own account", 400);

  if (role !== undefined && !["operator", "depotRep", "subAdmin"].includes(role)) {
    return err("Invalid role — bulk role changes cannot promote to admin", 400);
  }

  if (role === undefined && suspendedUntil === undefined) {
    return err("At least one of role or suspendedUntil is required", 400);
  }

  if (suspendedUntil !== null && suspendedUntil !== undefined) {
    const d = new Date(suspendedUntil);
    if (isNaN(d.getTime())) return err("Invalid suspendedUntil date", 400);
    if (d <= new Date()) return err("suspendedUntil must be in the future", 400);
  }

  const updateData: Record<string, unknown> = {};
  if (role !== undefined) updateData.role = role;
  if (suspendedUntil !== undefined) {
    updateData.suspendedUntil = suspendedUntil ? new Date(suspendedUntil) : null;
  }

  // Run all updates in a single transaction so partial failures don't leave inconsistent state
  await prisma.$transaction(
    userIds.map(id =>
      prisma.user.update({ where: { id }, data: updateData })
    )
  );

  // Invalidate active sessions for users whose role or suspension just changed.
  // Same reasoning as the single-user PATCH: don't let suspended/demoted users
  // keep elevated access until their token expires.
  const wasSuspended = suspendedUntil !== undefined && suspendedUntil !== null && new Date(suspendedUntil) > new Date();
  const wasRoleChanged = role !== undefined;
  let sessionsRevoked = true;
  if (wasSuspended || wasRoleChanged) {
    const results = await Promise.all(userIds.map(id => blockUserAccessTokens(id)));
    sessionsRevoked = results.every(Boolean);
    if (!sessionsRevoked) {
      // Silently dropping this would leave suspended or demoted users holding
      // valid access tokens with nothing recording that revocation failed.
      Sentry.captureMessage("blockUserAccessTokens failed during bulk suspension/role change", {
        level: "error",
        tags: { route: "admin/users/bulk PATCH" },
        extra: { failed: userIds.filter((_, i) => !results[i]).length, total: userIds.length },
      });
    }
  }

  // Invalidate unused invite codes from suspended users so the spam chain
  // doesn't continue through codes they shared.
  if (wasSuspended) {
    await prisma.inviteCode.updateMany({
      where: { createdBy: { in: userIds }, usedBy: null, isValid: true },
      data: { isValid: false },
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined;
  writeAuditLog({
    adminId: user.userId,
    action: "role_change",
    targetId: userIds.join(","),
    targetType: "user",
    detail: [
      `bulk update of ${userIds.length} users`,
      role !== undefined ? `role → ${role}` : null,
      suspendedUntil !== undefined ? `suspendedUntil → ${suspendedUntil ?? "cleared"}` : null,
    ].filter(Boolean).join(", "),
    ip,
  });

  return ok({ updated: userIds.length, sessionsRevoked });
}
