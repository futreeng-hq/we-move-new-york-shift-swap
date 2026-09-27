import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_4KB } from "@/lib/parseBody";

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  if (!await rateLimit(`feedback:${user.userId}`, 5, 3_600_000)) {
    return err("Too many feedback submissions — try again later", 429);
  }

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { message } = body as { message: string };
  if (!message?.trim()) return err("Message required", 400);

  try {
    await prisma.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        adminId: user.userId,
        action: "feedback",
        detail: message.trim().slice(0, 1000),
      },
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: "feedback-write" },
      extra: { userId: user.userId },
    });
    return err("Could not save feedback — try again", 500);
  }

  return ok({ received: true });
}
