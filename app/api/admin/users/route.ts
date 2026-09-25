import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { writeAuditLog } from "@/lib/audit";
import { parseBody, BODY_2KB, BODY_1KB } from "@/lib/parseBody";
import { blockUserAccessTokens } from "@/lib/tokenBlocklist";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || !["admin", "subAdmin"].includes(dbUser.role)) return err("Forbidden", 403);

  const isSubAdmin = dbUser.role === "subAdmin";
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";

  const users = await prisma.user.findMany({
    where: q ? {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        ...(!isSubAdmin ? [{ email: { contains: q, mode: "insensitive" as const } }] : []),
      ],
    } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, firstName: true, lastName: true,
      // subAdmin does not see email addresses
      ...(isSubAdmin ? {} : { email: true }),
      role: true, createdAt: true, lastActiveAt: true, suspendedUntil: true,
      depot: { select: { name: true, code: true } },
    },
  });

  return ok(users);
}

export async function PATCH(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || dbUser.role !== "admin") return err("Forbidden", 403);

  const patchBody = await parseBody(req, BODY_2KB);
  if (patchBody instanceof NextResponse) return patchBody;
  const { userId, role, depotId, suspendedUntil, verifiedOperator } = patchBody as {
    userId: string; role?: string; depotId?: string | null; suspendedUntil?: string; verifiedOperator?: boolean;
  };
  if (!userId) return err("userId required", 400);
  if (userId === user.userId) return err("Cannot change your own role", 400);

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true } });
  if (!target) return err("User not found", 404);

  // Validate role if provided
  if (role !== undefined && !["operator", "depotRep", "subAdmin", "admin"].includes(role)) {
    return err("Invalid role", 400);
  }
  if (role === "depotRep" && !depotId) return err("Depot is required for depot rep role", 400);

  const updated = await prisma.user.update({
    where: { id: userId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: {
      ...(role !== undefined && { role }),
      ...(depotId !== undefined && {
        depotId: depotId ?? null,
        depotSetAt: new Date(), // Admin resets the lock timer
      }),
      ...(suspendedUntil !== undefined && { suspendedUntil: new Date(suspendedUntil) }),
      ...(verifiedOperator !== undefined && { verifiedOperator }),
    } as Parameters<typeof prisma.user.update>[0]["data"],
    select: { id: true, firstName: true, lastName: true, role: true, depotId: true, suspendedUntil: true, depot: { select: { name: true, code: true } } },
  });

  // If admin suspended the user (or set suspendedUntil to a future date),
  // invalidate any active access tokens so the user is kicked from the app
  // immediately rather than continuing for up to 15min until token expiry.
  // Also invalidate when role changes — a demoted admin shouldn't keep their
  // privileges for the remainder of their token.
  const wasSuspended = suspendedUntil !== undefined && new Date(suspendedUntil) > new Date();
  const wasRoleChanged = role !== undefined && role !== target.role;
  let sessionsRevoked = true;
  if (wasSuspended || wasRoleChanged) {
    // Report the failure instead of dropping it: if the marker cannot be
    // written the suspended or demoted user keeps their current access token
    // for up to 15 more minutes, and the admin needs to know that.
    sessionsRevoked = await blockUserAccessTokens(userId);
    if (!sessionsRevoked) {
      Sentry.captureMessage("blockUserAccessTokens failed after admin suspension/role change", {
        level: "error",
        tags: { route: "admin/users PATCH" },
        extra: { targetUserId: userId },
      });
    }
  }

  // When a user is suspended, also invalidate their unused invite codes.
  // Otherwise the suspended user's codes (or codes they shared publicly) are
  // still claimable, opening the door to a chain of spam accounts.
  if (wasSuspended) {
    await prisma.inviteCode.updateMany({
      where: { createdBy: userId, usedBy: null, isValid: true },
      data: { isValid: false },
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined;
  writeAuditLog({
    adminId: user.userId,
    action: "role_change",
    targetId: userId,
    targetType: "user",
    detail: [
      role !== undefined ? `role → ${role}` : null,
      depotId !== undefined ? `depot → ${depotId ?? "none"}` : null,
    ].filter(Boolean).join(", ") + ` for ${target.email}`,
    ip,
  });

  // sessionsRevoked is surfaced so the admin UI can warn that a suspended or
  // demoted user may retain access for up to 15 minutes.
  return ok({ ...updated, sessionsRevoked });
}

export async function DELETE(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || dbUser.role !== "admin") return err("Forbidden", 403);

  const delBody = await parseBody(req, BODY_1KB);
  if (delBody instanceof NextResponse) return delBody;
  const { userId } = delBody as { userId: string };
  if (!userId) return err("userId required", 400);
  if (userId === user.userId) return err("Cannot delete your own account", 400);

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true, lastName: true } });
  if (!target) return err("User not found", 404);

  // Anonymize instead of hard delete to preserve swap/agreement history.
  // Swap.posterName and Swap.contact are denormalized copies of the user's
  // identity and contact details, so they must be cleared here too — otherwise
  // the name and phone number stay on the board and on the public teaser.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${userId}@deleted.invalid`,
        passwordHash: "deleted",
        firstName: "Deleted",
        lastName: "User",
        avatarUrl: null,
        depotId: null,
        pushSubscriptions: { deleteMany: {} },
      },
    }),
    prisma.swap.updateMany({
      where: { userId },
      data: { posterName: "Deleted User", contact: null },
    }),
  ]);

  // Deletion must also end live sessions; without this the deleted account
  // keeps full API access until its access token expires.
  if (!await blockUserAccessTokens(userId)) {
    Sentry.captureMessage("blockUserAccessTokens failed after admin account deletion", {
      level: "error",
      tags: { route: "admin/users DELETE" },
      extra: { targetUserId: userId },
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined;
  writeAuditLog({
    adminId: user.userId,
    action: "user_delete",
    targetId: userId,
    targetType: "user",
    // targetId identifies the account; the email is deliberately omitted so
    // the deletion does not leave the address behind in the audit log.
    detail: "Deleted account",
    ip,
  });

  return ok({ deleted: true });
}
