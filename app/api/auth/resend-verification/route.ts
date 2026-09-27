import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { ok, err } from "@/lib/apiResponse";
import { rateLimitStatusByIp, rateLimitResponse, clientIp } from "@/lib/rateLimit";
import { parseBody, BODY_1KB } from "@/lib/parseBody";
import { escapeHtml } from "@/lib/escapeHtml";
import { getAppUrl } from "@/lib/appUrl";

// POST /api/auth/resend-verification
// Accepts { email } — re-issues a verification token if the account exists and is unverified.
// Always returns 200 to prevent account enumeration. Same timing-safe pattern as forgot-password.
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitStatusByIp(ip, "resend-verify", 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    // Only a real limit hit is an abuse signal — a Redis outage denies by
    // policy and rateLimitStatus() reports that itself. See lib/rateLimit.ts.
    if (rl.reason === "limited") Sentry.captureEvent({ message: "Resend-verification rate limit hit", level: "warning", tags: { ip } });
    return rateLimitResponse(rl, "Too many attempts — try again in 15 minutes");
  }

  const body = await parseBody(req, BODY_1KB);
  if (body instanceof NextResponse) return body;
  const { email } = body as { email: string };
  if (!email || typeof email !== "string") return err("Email required", 400);

  // Minimum response time prevents timing-based account enumeration
  const minDuration = 400;
  const startedAt = Date.now();

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, email: true, firstName: true, verified: true },
    });

    // Only send if the account exists AND is not already verified.
    // Either way, response is identical to prevent enumeration.
    if (user && !user.verified) {
      const verifyToken = crypto.randomBytes(32).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifyToken: verifyToken,
          emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const appUrl = getAppUrl();
      if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
      const verifyLink = `${appUrl}/verify-email/${verifyToken}`;
      const safeFirstName = escapeHtml(user.firstName);

      try {
        await sendEmail(
          user.email,
          "Verify your WMNY Shift Swap email",
          `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#010028;color:#fff;border-radius:16px">
            <h1 style="font-size:22px;font-weight:800;margin-bottom:8px">Verify your email</h1>
            <p style="color:rgba(255,255,255,.6);font-size:14px;line-height:1.6;margin-bottom:24px">
              Hi ${safeFirstName}, here's a fresh link to verify your WMNY Shift Swap account.
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
          tags: { source: "resend-verification-email" },
          extra: { userId: user.id },
        });
      }
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { source: "resend-verification" } });
  }

  // Pad response to minDuration regardless of outcome
  const elapsed = Date.now() - startedAt;
  if (elapsed < minDuration) await new Promise(r => setTimeout(r, minDuration - elapsed));

  // Always 200 to prevent enumeration
  return ok({ message: "If that account exists and is unverified, a new link has been sent." });
}
