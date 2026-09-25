import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { signAccessToken, signRefreshToken } from "@/lib/auth";
import { err } from "@/lib/apiResponse";
import { rateLimitByIp, clientIp } from "@/lib/rateLimit";
import { parseBody, BODY_1KB } from "@/lib/parseBody";
import { writeAuditLog } from "@/lib/audit";
import { isDepotInSoftLaunch } from "@/lib/softLaunch";

const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Compared against when the email does not exist, so an unknown address costs
// the same ~100ms bcrypt round as a known one. Without this, "no such user"
// returned immediately and "wrong password" returned after the hash — a timing
// oracle that enumerates the whole membership regardless of what the response
// body says. forgot-password and resend-verification already pad to 400ms for
// exactly this reason; login did not.
//
// This is a bcrypt hash of 32 random bytes at the same cost factor the app
// uses. It is not a secret and nothing can match it.
const DUMMY_HASH = "$2b$10$Mnydv3B1c4kshS5SYO6m0e8uiqa44MpVGuCiC/T/qXE6hhWZNCMwq";

/** One message for every credential failure, so the response reveals nothing. */
const GENERIC_CREDENTIAL_ERROR = "Invalid email or password";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (!await rateLimitByIp(ip, "login", 10, 60_000)) {
      Sentry.captureEvent({
        message: "Login rate limit hit",
        level: "warning",
        tags: { ip },
      });
      return err("Too many attempts — try again in a minute", 429);
    }

    const body = await parseBody(req, BODY_1KB);
    if (body instanceof NextResponse) return body;
    const { email, password } = body as { email: string; password: string };
    if (!email || !password) return err("Email and password required", 400);
    if (password.length > 128) return err("Password too long", 400);

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { depot: true } });

    // Always run the hash comparison, even for an unknown email, so the
    // response time does not distinguish the two cases.
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    // An expired lock is spent. Resetting the counter here is what stops an
    // indefinite-lockout DoS: previously loginAttempts was only ever cleared on
    // a SUCCESSFUL login, so once it reached 10, one wrong password every 15
    // minutes — far under the 10/min IP limit — re-locked a known account
    // forever, and its owner could never get in to reset it.
    const lockActive = Boolean(user?.lockedUntil && user.lockedUntil > new Date());
    const effectiveAttempts = user && !lockActive && user.lockedUntil ? 0 : (user?.loginAttempts ?? 0);

    if (!user || !valid) {
      if (user) {
        const attempts = effectiveAttempts + 1;
        // Do not extend a lock that is already running — that is the DoS.
        const shouldLock = !lockActive && attempts >= MAX_ATTEMPTS;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            loginAttempts: attempts,
            ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}),
            ...(!lockActive && user.lockedUntil && attempts < MAX_ATTEMPTS ? { lockedUntil: null } : {}),
          },
        });
        writeAuditLog({
          adminId: user.id,
          action: "login_failed",
          targetId: user.id,
          targetType: "user",
          detail: `Failed login attempt (${attempts}/${MAX_ATTEMPTS})${shouldLock ? " — account locked" : ""}`,
          ip: ip ?? undefined,
        });
        if (shouldLock) {
          Sentry.captureEvent({
            message: "Account locked after repeated failed logins",
            level: "warning",
            tags: { ip },
            extra: { userId: user.id },
          });
        }
      }
      // Same status and same body whether the address is unknown, the password
      // is wrong, or the account is locked. Locked accounts used to answer 423
      // and unverified ones 403 with distinct text, which enumerated the
      // membership from the response alone.
      return err(GENERIC_CREDENTIAL_ERROR, 401);
    }

    // Past this point the caller has proven they hold the password, so it is
    // safe — and much kinder — to say precisely what is wrong.
    if (lockActive && user.lockedUntil) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      return err(`Account locked — too many failed attempts. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.`, 423);
    }

    if (!user.verified) {
      return err("Please verify your email before signing in. Check your inbox.", 403);
    }

    // Successful login — reset lockout counters
    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null },
    });

    // Soft launch gate — only allow depots in the SOFT_LAUNCH_DEPOT allowlist
    // (admins bypass). The allowlist accepts a single code ("QV") or a
    // comma-separated list ("QV,WF,MV"). When the env var is unset, no
    // restriction applies.
    if (
      !["admin", "subAdmin"].includes(user.role) &&
      user.depotId &&
      !isDepotInSoftLaunch(user.depot?.code)
    ) {
      return err(`WMNY Shift Swap is currently in limited soft launch. We'll be at your depot soon!`, 403);
    }

    const payload = { userId: user.id, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    const res = NextResponse.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        depotId: user.depotId,
        depot: user.depot,
        role: user.role,
        language: user.language,
        termsVersion: user.termsVersion,
      },
    });

    const isProd = process.env.NODE_ENV === "production";
    res.cookies.set("accessToken", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      path: "/",
      maxAge: 900, // 15 minutes
    });
    res.cookies.set("refreshToken", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      path: "/api/auth",
      maxAge: 604800, // 7 days
    });

    return res;
  } catch (e: unknown) {
    console.error("[login] unexpected error:", e);
    return err("An unexpected error occurred. Please try again.", 500);
  }
}
