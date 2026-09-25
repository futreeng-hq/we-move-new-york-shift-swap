import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import * as Sentry from "@sentry/nextjs";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calcScore } from "@/lib/reputation";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_200KB } from "@/lib/parseBody";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/escapeHtml";
import { getAppUrl } from "@/lib/appUrl";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    include: { depot: true },
  });
  if (!dbUser) return err("User not found", 404);

  // Block suspended or soft-deleted accounts from reading their own profile.
  // Without this, the UI's auth-context would think they're logged in even
  // though they shouldn't be able to use any other endpoint.
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const rep = await prisma.reputation.findUnique({ where: { userId: user.userId } });
  const reviews = await prisma.review.findMany({
    where: { reviewedId: user.userId },
    select: { rating: true },
  });
  const reputation = calcScore({
    completed: rep?.completed ?? 0,
    cancelled: rep?.cancelled ?? 0,
    noShow: rep?.noShow ?? 0,
    reviews: reviews.map((r) => r.rating),
  });

  const inviteCodes = await prisma.inviteCode.findMany({
    where: { createdBy: user.userId },
    select: { code: true, isValid: true },
  });

  return ok({
    id: dbUser.id,
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    email: dbUser.email,
    depotId: dbUser.depotId,
    depot: dbUser.depot,
    role: dbUser.role,
    language: dbUser.language,
    avatarUrl: dbUser.avatarUrl,
    flexibleMode: dbUser.flexibleMode,
    termsVersion: dbUser.termsVersion,
    reputation,
    inviteCodes,
    jobTitle: dbUser.jobTitle,
    depotSetAt: dbUser.depotSetAt?.toISOString() ?? null,
    verifiedOperator: dbUser.verifiedOperator,
  });
}

export async function PUT(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const body = await parseBody(req, BODY_200KB);
  if (body instanceof NextResponse) return body;
  const { firstName, lastName, email, language, depotId, jobTitle, avatarUrl } = body as {
    firstName?: string; lastName?: string; email?: string; language?: string;
    depotId?: string; jobTitle?: string; avatarUrl?: string;
  };

  const callerUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { email: true, suspendedUntil: true } });
  if (!callerUser) return err("User not found", 404);
  const activeErr = checkActive(callerUser);
  if (activeErr) return err(activeErr, 403);

  if (firstName && firstName.trim().length > 50) return err("First name must be 50 characters or fewer", 400);
  if (lastName && lastName.trim().length > 50) return err("Last name must be 50 characters or fewer", 400);
  if (email && email.trim().length > 254) return err("Email must be 254 characters or fewer", 400);
  if (language && language.length > 10) return err("Invalid language value", 400);
  if (jobTitle && jobTitle.length > 100) return err("Job title must be 100 characters or fewer", 400);

  // Validate avatarUrl — allow base64 data URLs (from client-side canvas resize) or HTTPS URLs
  if (avatarUrl !== undefined && avatarUrl !== null) {
    if (avatarUrl.startsWith("data:image/")) {
      if (avatarUrl.length > 200_000) return err("Avatar image too large", 400);
    } else {
      try {
        const parsed = new URL(avatarUrl);
        if (parsed.protocol !== "https:") return err("Avatar URL must use HTTPS", 400);
        const host = parsed.hostname.toLowerCase();
        // Block private/internal address ranges. Avatar URLs are loaded by
        // viewers' browsers, so this isn't strict server-side SSRF — but
        // linking to internal hosts can leak through referer headers and
        // produces broken UX, so reject.
        const blockedExact = new Set(["localhost", "0.0.0.0", "::", "::1"]);
        const blockedPrefixes = [
          "127.",         // IPv4 loopback
          "10.",          // RFC1918 /8
          "192.168.",     // RFC1918 /16
          "169.254.",     // link-local
          "fe80:",        // IPv6 link-local
          "fc00:", "fd",  // IPv6 unique-local
        ];
        let blocked = blockedExact.has(host);
        if (!blocked) {
          // 172.16.0.0/12 covers 172.16. through 172.31.
          const m = host.match(/^172\.(\d+)\./);
          if (m && parseInt(m[1], 10) >= 16 && parseInt(m[1], 10) <= 31) blocked = true;
        }
        if (!blocked && blockedPrefixes.some(p => host.startsWith(p))) blocked = true;
        if (blocked) return err("Invalid avatar URL", 400);
      } catch {
        return err("Invalid avatar URL", 400);
      }
    }
  }

  if (email) {
    const existing = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), NOT: { id: user.userId } },
    });
    if (existing) return err("Email already in use", 409);

    // Format was never validated — only length. A user could set their address
    // to anything, including a domain they do not control, and stay `verified`.
    const normalized = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(normalized)) {
      return err("Enter a valid email address", 400);
    }
    // @deleted.invalid is the sentinel checkActive() reads as a deleted
    // account, so accepting it here let a user permanently lock themselves out
    // with no admin-visible cause.
    if (normalized.endsWith("@deleted.invalid")) {
      return err("Enter a valid email address", 400);
    }
  }

  // Depot change enforcement
  if (depotId !== undefined) {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { depotId: true, depotSetAt: true, role: true },
    });
    const isAdmin = dbUser?.role === "admin" || dbUser?.role === "subAdmin";
    // The cooldown used to be skipped whenever the CURRENT depotId was null or
    // the NEW value was null, so setting depotId to null and then to the target
    // defeated it entirely in two requests. Clearing the depot now counts as a
    // change and starts the clock like any other.
    if (!isAdmin && dbUser?.depotId !== depotId) {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (dbUser?.depotSetAt && (Date.now() - dbUser.depotSetAt.getTime()) < sevenDaysMs) {
        const unlocksAt = new Date(dbUser.depotSetAt.getTime() + sevenDaysMs);
        return err(`Home depot can only be changed once every 7 days. Unlocks ${unlocksAt.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`, 403);
      }
    }
  }

  // Changing the address must re-open verification. Previously `verified` was
  // left at true, so a user could move their account to an address they do not
  // control and keep full access to it — and `verified` is only ever enforced
  // at login and refresh, never on a write path, so the existing session
  // carried on regardless.
  const normalizedEmail = email ? email.toLowerCase().trim() : undefined;
  const emailIsChanging = Boolean(normalizedEmail && normalizedEmail !== callerUser.email);
  const verifyToken = emailIsChanging ? crypto.randomBytes(32).toString("hex") : null;

  const updated = await prisma.user.update({
    where: { id: user.userId },
    data: {
      ...(firstName && { firstName: firstName.trim() }),
      ...(lastName && { lastName: lastName.trim() }),
      ...(normalizedEmail && { email: normalizedEmail }),
      ...(emailIsChanging && {
        verified: false,
        emailVerifyToken: verifyToken,
        emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
      ...(language && { language }),
      ...(jobTitle !== undefined && { jobTitle }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      // depotSetAt is stamped on every depot change, including clearing it, so
      // the 7-day cooldown cannot be reset by round-tripping through null.
      ...(depotId !== undefined && { depotId, depotSetAt: new Date() }),
    },
    include: { depot: true },
  });

  if (emailIsChanging && verifyToken) {
    const appUrl = getAppUrl();
    if (appUrl) {
      const verifyLink = `${appUrl}/verify-email/${verifyToken}`;
      const safeFirstName = escapeHtml(updated.firstName);
      try {
        await sendEmail(
          updated.email,
          "Verify your new WMNY Shift Swap email",
          `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#010028;color:#fff;border-radius:16px">
            <h1 style="font-size:22px;font-weight:800;margin-bottom:8px">Verify your new email</h1>
            <p style="color:rgba(255,255,255,.6);font-size:14px;line-height:1.6;margin-bottom:24px">
              Hi ${safeFirstName}, you changed the email on your WMNY Shift Swap account.
              Confirm this address to finish. This link expires in 24 hours.
            </p>
            <a href="${verifyLink}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#D1AD38;color:#010028;font-weight:700;font-size:15px;text-decoration:none">
              Verify Email
            </a>
            <p style="color:rgba(255,255,255,.4);font-size:12px;margin-top:24px">
              If you didn't change your email, contact support right away.
            </p>
          </div>`,
        );
      } catch (e) {
        // Non-fatal: the change is already saved and resend-verification can
        // re-issue. Surfaced so a silent delivery failure is not invisible.
        Sentry.captureException(e, { tags: { route: "users/me PUT email-change" } });
      }
    }
  }

  return ok({
    id: updated.id,
    firstName: updated.firstName,
    lastName: updated.lastName,
    email: updated.email,
    depotId: updated.depotId,
    depot: updated.depot,
    role: updated.role,
    language: updated.language,
    jobTitle: updated.jobTitle,
    depotSetAt: updated.depotSetAt?.toISOString() ?? null,
  });
}
