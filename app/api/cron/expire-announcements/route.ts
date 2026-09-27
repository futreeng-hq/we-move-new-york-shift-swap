import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { pingHeartbeat } from "@/lib/heartbeat";

// Cron work is unbounded in row count. Without an explicit ceiling the
// function is killed at the platform default mid-loop: partial work, no
// heartbeat ping, and no error recorded anywhere.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return err("Unauthorized", 401);

  try {
    const result = await prisma.announcement.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await pingHeartbeat("expire-announcements");
    return ok({ deleted: result.count });
  } catch (e) {
    // Every handler swallowed its error into a 500, so nothing ever threw,
    // onRequestError never fired, and no Sentry event was created. The only
    // signal was heartbeat silence — and HEARTBEAT_URL_BASE is commented out
    // in .env.example, so a cron failing daily was invisible.
    Sentry.captureException(e, { tags: { cron: "expire-announcements" } });
    return err(`Cron failed: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
