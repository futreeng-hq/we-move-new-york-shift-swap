import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { genInviteCode } from "@/lib/inviteCode";
import { err } from "@/lib/apiResponse";
import { rateLimitByIp, clientIp } from "@/lib/rateLimit";
import { parseBody, BODY_4KB } from "@/lib/parseBody";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/escapeHtml";
import { getAppUrl } from "@/lib/appUrl";

// Growth attribution: the teaser page sets wmny_src when a shared link carries
// ?src=share. Allowlist known values so the column stays clean.
const KNOWN_SIGNUP_SOURCES = new Set(["share"]);

export async function POST(req: NextRequest) {
  const rawSrc = req.cookies.get("wmny_src")?.value;
  const signupSource = rawSrc && KNOWN_SIGNUP_SOURCES.has(rawSrc) ? rawSrc : null;
  // Validate env at the top — if this throws after user creation (old position) it
  // returns HTML 500 which the client can't parse, producing "Request failed".
  const appUrl = getAppUrl();
  if (!appUrl) {
    Sentry.captureMessage("NEXT_PUBLIC_APP_URL is not set", "error");
    return err("Server configuration error — contact support", 500);
  }

  const ip = clientIp(req);
  if (!await rateLimitByIp(ip, "register", 5, 3_600_000)) {
    Sentry.captureEvent({ message: "Register rate limit hit", level: "warning", tags: { ip } });
    return err("Too many registration attempts — try again in an hour", 429);
  }

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { firstName, lastName, email, password, inviteCode } = body as {
    firstName: string; lastName: string; email: string; password: string;
    inviteCode?: string;
  };

  if (!firstName || !lastName || !email || !password) {
    return err("All fields are required", 400);
  }
  if (!inviteCode) return err("Invite code is required", 400);
  if (!email.includes("@")) return err("Invalid email", 400);
  if (firstName.trim().length > 50) return err("First name must be 50 characters or fewer", 400);
  if (lastName.trim().length > 50) return err("Last name must be 50 characters or fewer", 400);
  if (inviteCode && inviteCode.length > 20) return err("Invalid invite code", 400);
  if (password.length < 12) return err("Password must be at least 12 characters", 400);
  if (password.length > 128) return err("Password must be 128 characters or fewer", 400);

  // Reject passwords that are purely numeric or common patterns
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialOrMixed = /[^a-zA-Z0-9]/.test(password) || (hasLetter && hasNumber);
  if (!hasSpecialOrMixed) return err("Password must contain letters and numbers", 400);

  // Check the invite code BEFORE answering whether the email exists. Otherwise
  // any garbage code enumerates the membership: the 409 "Email already
  // registered" came back before the code was ever validated (validation
  // happens inside the transaction below), so an attacker needed no valid
  // invite at all — just 5 guesses per hour per IP against a list of addresses.
  //
  // This is a read-only pre-check for the error ordering. The transaction below
  // still does the atomic claim, which is what actually prevents two
  // simultaneous registrations consuming the same code.
  const codeUpperPrecheck = (inviteCode as string).trim().toUpperCase();
  const invitePrecheck = await prisma.inviteCode.findFirst({
    where: { code: codeUpperPrecheck, isValid: true },
    select: { id: true },
  });
  if (!invitePrecheck) return err("Invalid or already-used invite code", 400);

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return err("Email already registered", 409);

  const passwordHash = await bcrypt.hash(password, 10);
  const verifyToken = crypto.randomBytes(32).toString("hex");

  let newCodes: string[] = [];
  let user;

  {
    const codeUpper = (inviteCode as string).trim().toUpperCase();

    try {
      user = await prisma.$transaction(async (tx) => {
        // Atomically claim the invite code — prevents race conditions where two
        // simultaneous registrations consume the same code
        const claimed = await tx.inviteCode.updateMany({
          where: { code: codeUpper, isValid: true },
          data: { isValid: false },
        });
        if (claimed.count === 0) throw new Error("INVALID_INVITE");

        const invite = await tx.inviteCode.findUnique({
          where: { code: codeUpper },
          select: { createdBy: true },
        });

        const newUser = await tx.user.create({
          data: {
            email: email.toLowerCase().trim(),
            passwordHash,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            role: "operator",
            verified: false,
            emailVerifyToken: verifyToken,
            emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            ...(invite?.createdBy ? { invitedBy: invite.createdBy } : {}),
            ...(signupSource ? { signupSource } : {}),
          },
        });

        await tx.inviteCode.updateMany({
          where: { code: codeUpper },
          data: { usedBy: newUser.id },
        });

        return newUser;
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "INVALID_INVITE") {
        return err("Invalid invite code", 400);
      }
      Sentry.captureException(e, { tags: { source: "register-transaction" } });
      return err("Registration failed — please try again", 500);
    }

    // Generate 3 new invite codes for new operator (outside transaction — non-critical)
    try {
      for (let i = 0; i < 3; i++) {
        let code = genInviteCode();
        while (await prisma.inviteCode.findUnique({ where: { code } })) {
          code = genInviteCode();
        }
        await prisma.inviteCode.create({ data: { code, createdBy: user.id } });
        newCodes.push(code);
      }
    } catch (e) {
      Sentry.captureException(e, { tags: { source: "register-invite-codes" }, extra: { userId: user.id } });
    }

    // Initialize reputation — upsert is safe if this runs more than once (e.g. after a retry)
    try {
      await prisma.reputation.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    } catch (e) {
      Sentry.captureException(e, { tags: { source: "register-reputation" }, extra: { userId: user.id } });
    }
  }

  // Send verification email — HTML-escape user-supplied name fields
  const verifyLink = `${appUrl}/verify-email/${verifyToken}`;
  const safeFirstName = escapeHtml(user.firstName);
  try {
    await sendEmail(
      user.email,
      "Verify your WMNY Shift Swap email",
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#010028;color:#fff;border-radius:16px">
        <h1 style="font-size:22px;font-weight:800;margin-bottom:8px">Verify your email</h1>
        <p style="color:rgba(255,255,255,.6);font-size:14px;line-height:1.6;margin-bottom:24px">
          Hi ${safeFirstName}, thanks for joining WMNY Shift Swap! Please verify your email address to activate your account.
          This link expires in 24 hours.
        </p>
        <a href="${verifyLink}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#D1AD38;color:#010028;font-weight:700;font-size:15px;text-decoration:none">
          Verify Email
        </a>
        <p style="color:rgba(255,255,255,.4);font-size:12px;margin-top:24px">
          If you didn't create a WMNY Shift Swap account, you can safely ignore this email.
        </p>
      </div>`
    );
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: "register-verify-email" },
      extra: { userId: user.id, email: user.email },
    });
    // Non-fatal: user is created, they can use "Resend verification email" if needed
  }

  // No auto-login on register — user must verify email and then log in.
  // This ensures the email address is real and prevents account claim from
  // a leaked invite code reaching someone with a stolen/typo'd email.
  const res = NextResponse.json({
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      depotId: user.depotId,
      role: user.role,
      language: user.language,
    },
    ...(newCodes.length > 0 ? { inviteCodes: newCodes } : {}),
    emailVerificationRequired: true,
  }, { status: 201 });

  return res;
}
