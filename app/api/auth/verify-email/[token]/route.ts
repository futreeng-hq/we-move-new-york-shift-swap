import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { rateLimitByIp, clientIp } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/escapeHtml";
import { getAppUrl } from "@/lib/appUrl";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = clientIp(req);
  if (!await rateLimitByIp(ip, "verify-email", 5, 15 * 60 * 1000)) {
    Sentry.captureEvent({ message: "Verify-email rate limit hit", level: "warning", tags: { ip } });
    return err("Too many attempts — try again in 15 minutes", 429);
  }

  try {
    const { token } = await params;

    const user = await prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
        emailVerifyExpires: { gt: new Date() },
      },
    });

    if (!user) return err("Invalid or expired verification link", 400);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        verified: true,
        emailVerifyToken: null,
        emailVerifyExpires: null,
      },
    });

    // Welcome email — sent once, right after the user verifies their email.
    // The verify token is now cleared, so this branch can never fire twice
    // for the same user. Non-fatal: a failed send doesn't roll back verification,
    // it just gets reported to Sentry so we know if Resend is degraded.
    // No production fallback: hardcoding it meant a preview or staging deploy
    // whose NEXT_PUBLIC_APP_URL was missing silently redirected users into
    // PRODUCTION mid-verification, so the token was consumed against the wrong
    // environment. Better to fail visibly than to cross environments.
    const appUrl = getAppUrl();
    if (!appUrl) return err("Server configuration error — contact support", 500);
    const safeFirstName = escapeHtml(user.firstName);
    const welcomeHtml = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#010028;color:#fff;border-radius:16px">
  <h1 style="font-size:22px;font-weight:800;margin:0 0 8px">Welcome aboard, ${safeFirstName} 🚌</h1>
  <p style="color:rgba(255,255,255,.65);font-size:14px;line-height:1.6;margin:0 0 24px">
    WMNY Shift Swap was built by operators, for operators — and you're now part of it.
  </p>

  <a href="${appUrl}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#D1AD38;color:#010028;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:28px">
    Open WMNY Shift Swap
  </a>

  <h2 style="font-size:14px;font-weight:700;color:#D1AD38;text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 8px">The point</h2>
  <p style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.7;margin:0 0 20px">
    Coordinating swaps over group texts and bulletin boards is a mess. WMNY Shift Swap puts every available swap in one place where you can find it, message the operator directly, and lock the agreement in. Works for daily work swaps, RDOs, and vacation weeks.
  </p>

  <h2 style="font-size:14px;font-weight:700;color:#D1AD38;text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 8px">Two things to keep in mind</h2>
  <p style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.7;margin:0 0 20px">
    WMNY Shift Swap is independent — not affiliated with the MTA or any union. And it doesn't change your swap process — every swap still goes through your dispatcher the normal way. We just help you find the swap faster.
  </p>

  <h2 style="font-size:14px;font-weight:700;color:#D1AD38;text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 8px">Getting started</h2>
  <ol style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.8;margin:0 0 20px;padding-left:20px">
    <li><strong style="color:#fff">Pick your depot.</strong> This is your home base — you'll see swaps from your depot first.</li>
    <li><strong style="color:#fff">Post a swap or browse.</strong> Need a Saturday off? Post it. Looking to pick up a Tuesday run? Browse.</li>
    <li><strong style="color:#fff">Message, agree, print.</strong> Talk it out in-app, confirm with the other operator, print the agreement, hand it to your dispatcher.</li>
  </ol>

  <h2 style="font-size:14px;font-weight:700;color:#D1AD38;text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 8px">3 invite codes are waiting for you</h2>
  <p style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.7;margin:0 0 12px">
    Each new operator gets 3 invite codes to share. We grow this thing one trusted operator at a time. Find your codes in your profile — only share them with operators you'd vouch for.
  </p>
  <a href="${appUrl}/profile" style="color:#D1AD38;font-size:13px;font-weight:600;text-decoration:underline">View my invite codes →</a>

  <h2 style="font-size:14px;font-weight:700;color:#D1AD38;text-transform:uppercase;letter-spacing:1.5px;margin:28px 0 8px">Stuck on something?</h2>
  <p style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.7;margin:0 0 24px">
    Email <a href="mailto:wemovenewyork.net@gmail.com" style="color:#D1AD38;text-decoration:underline">wemovenewyork.net@gmail.com</a> — real human, real fast response.
  </p>

  <p style="color:rgba(255,255,255,.55);font-size:13px;line-height:1.6;margin:0 0 4px">Drive safe.</p>
  <p style="color:#fff;font-size:14px;font-weight:700;margin:0">👊 We Move New York</p>
</div>`;

    const welcomeText = `Welcome aboard, ${user.firstName}!

WMNY Shift Swap was built by operators, for operators — and you're now part of it.

Open the app: ${appUrl}

THE POINT

Coordinating swaps over group texts and bulletin boards is a mess. WMNY Shift Swap puts every available swap in one place where you can find it, message the operator directly, and lock the agreement in. Works for daily work swaps, RDOs, and vacation weeks.

TWO THINGS TO KEEP IN MIND

WMNY Shift Swap is independent — not affiliated with the MTA or any union. And it doesn't change your swap process — every swap still goes through your dispatcher the normal way. We just help you find the swap faster.

GETTING STARTED

1. Pick your depot. This is your home base — you'll see swaps from your depot first.
2. Post a swap or browse. Need a Saturday off? Post it. Looking to pick up a Tuesday run? Browse.
3. Message, agree, print. Talk it out in-app, confirm with the other operator, print the agreement, hand it to your dispatcher.

3 INVITE CODES ARE WAITING FOR YOU

Each new operator gets 3 invite codes to share. We grow this thing one trusted operator at a time. Find your codes in your profile — only share them with operators you'd vouch for.

View your invite codes: ${appUrl}/profile

STUCK ON SOMETHING?

Email wemovenewyork.net@gmail.com — real human, real fast response.

Drive safe.

— We Move New York`;

    try {
      await sendEmail(user.email, "You're in — welcome to WMNY Shift Swap", welcomeHtml, welcomeText);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { source: "verify-email-welcome" },
        extra: { userId: user.id, email: user.email },
      });
      // Non-fatal — verification already succeeded; user can still sign in.
    }

    return ok({ verified: true });
  } catch {
    return err("Verification failed — please try again", 503);
  }
}
