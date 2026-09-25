import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { notifyMany, notifyUser } from "@/lib/notifyUser";
import { nyToday } from "@/lib/nyDate";
import { pingHeartbeat } from "@/lib/heartbeat";

// Runs daily — notifies owners and interested users about swaps expiring tomorrow
// Cron work is unbounded in row count. Without an explicit ceiling the
// function is killed at the platform default mid-loop: partial work, no
// heartbeat ping, and no error recorded anywhere.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return err("Unauthorized", 401);

  try {
  // Compute "tomorrow" in NYC time (America/New_York) so the window aligns with
  // operators' actual calendar day, not the UTC server clock.
  //
  // This was the only date logic in the app bypassing lib/nyDate, and it did so
  // by re-parsing toLocaleString("en-US") output — a format ECMA-262 leaves
  // implementation-defined, so it is correct on this runtime by luck rather
  // than by contract. nyToday() uses Intl parts directly and is covered by
  // test/nyDate.test.ts across EST, EDT and both DST transitions.
  const today = nyToday();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const dayAfter = new Date(today.getTime() + 48 * 60 * 60 * 1000);

  const swaps = await prisma.swap.findMany({
    where: { status: "open", date: { gte: tomorrow, lt: dayAfter } },
    select: { id: true, userId: true, depotId: true, details: true },
  });

  if (swaps.length === 0) { await pingHeartbeat("expiring-soon"); return ok({ notified: 0 }); }

  let notified = 0;
  for (const swap of swaps) {
    const snippet = swap.details.substring(0, 60);

    // Notify swap owner
    // Must be awaited: the serverless instance is frozen the moment the
    // response is returned, so a floating promise here is silently dropped
    // and the cron still reports 200 + pings the heartbeat.
    await notifyUser(swap.userId, {
      category: "swap_updates",
      title: "Your swap expires tomorrow",
      body: `"${snippet}" — fill it or repost before it expires`,
      url: `/depot/${swap.depotId}/my`,
    });

    // Notify interested users (those who messaged about it)
    const interested = await prisma.message.findMany({
      where: { swapId: swap.id, fromUserId: { not: swap.userId } },
      select: { fromUserId: true },
      distinct: ["fromUserId"],
    });
    const ids = interested.map(m => m.fromUserId);
    if (ids.length > 0) {
      await notifyMany(ids, {
        category: "swap_updates",
      title: "Swap expiring tomorrow",
        body: `"${snippet}" — reach out now before it's gone`,
        url: `/depot/${swap.depotId}/swaps/${swap.id}`,
      });
    }
    notified++;
  }

  await pingHeartbeat("expiring-soon");
    return ok({ notified });
  } catch (e) {
    // Every handler swallowed its error into a 500, so nothing ever threw,
    // onRequestError never fired, and no Sentry event was created. The only
    // signal was heartbeat silence — and HEARTBEAT_URL_BASE is commented out
    // in .env.example, so a cron failing daily was invisible.
    Sentry.captureException(e, { tags: { cron: "expiring-soon" } });
    return err(`Cron failed: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
