import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { notifyMany, notifyUser } from "@/lib/notifyUser";
import { pingHeartbeat } from "@/lib/heartbeat";

// Runs daily — notifies owners and interested users about swaps expiring tomorrow
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return err("Unauthorized", 401);

  try {
  // Compute "tomorrow" in NYC time (America/New_York) so the window
  // aligns with operators' actual calendar day, not the UTC server clock.
  const nycNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const tomorrow = new Date(Date.UTC(nycNow.getFullYear(), nycNow.getMonth(), nycNow.getDate() + 1));
  const dayAfter  = new Date(Date.UTC(nycNow.getFullYear(), nycNow.getMonth(), nycNow.getDate() + 2));

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
    return err(`Cron failed: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
