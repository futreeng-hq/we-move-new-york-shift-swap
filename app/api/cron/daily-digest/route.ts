import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { notifyMany } from "@/lib/notifyUser";
import { getPrefsMany } from "@/lib/notificationPrefs";
import { pingHeartbeat } from "@/lib/heartbeat";

// Runs every morning at 12:00 UTC = 8 AM EDT / 7 AM EST — sends each subscribed operator a summary of
// new open swaps posted in their depot in the last 24 hours.
//
// A7: routed through notifyMany with category "digest" (in-app records +
// future logic stay centralized; the central filter also applies quiet hours,
// moot at 7 AM by definition — no special-casing). Excluded here: users whose
// `digest` pref is off, and users whose `new_post` mode is "off" (they opted
// out of new-post noise entirely). Modes digest/all/matches all still get the
// digest — it's the summary layer.
// Cron work is unbounded in row count. Without an explicit ceiling the
// function is killed at the platform default mid-loop: partial work, no
// heartbeat ping, and no error recorded anywhere.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return err("Unauthorized", 401);

  try {
    const since = new Date(Date.now() - 86_400_000);

    // Group new swaps by depotId
    const newSwaps = await prisma.swap.findMany({
      where: { status: "open", createdAt: { gte: since } },
      select: { depotId: true, category: true },
    });

    const countsByDepot = new Map<string, number>();
    for (const s of newSwaps) {
      countsByDepot.set(s.depotId, (countsByDepot.get(s.depotId) ?? 0) + 1);
    }

    if (countsByDepot.size === 0) { await pingHeartbeat("daily-digest"); return ok({ sent: 0, message: "No new swaps" }); }

    // Subscribed users in affected depots, grouped per depot so each gets
    // their own count in the message body.
    const users = await prisma.user.findMany({
      where: {
        depotId: { in: Array.from(countsByDepot.keys()) },
        pushSubscriptions: { some: {} },
      },
      select: { id: true, depotId: true },
    });
    if (users.length === 0) { await pingHeartbeat("daily-digest"); return ok({ sent: 0 }); }

    const prefsMap = await getPrefsMany(users.map(u => u.id));
    const byDepot = new Map<string, string[]>();
    let excluded = 0;
    for (const u of users) {
      const p = prefsMap.get(u.id)?.prefs;
      if (!p || p.digest === false || p.new_post === "off") { excluded++; continue; }
      if (!u.depotId) continue;
      const arr = byDepot.get(u.depotId) ?? [];
      arr.push(u.id);
      byDepot.set(u.depotId, arr);
    }

    let sent = 0;
    for (const [depotId, ids] of byDepot) {
      const count = countsByDepot.get(depotId) ?? 0;
      if (count === 0 || ids.length === 0) continue;
      await notifyMany(ids, {
        category: "digest",
        title: "WMNY Shift Swap — Daily Digest",
        body: `${count} new swap${count === 1 ? "" : "s"} posted at your depot today.`,
        url: "/depots",
      });
      sent += ids.length;
    }

    await pingHeartbeat("daily-digest");
    return ok({ sent, excluded });
  } catch (e) {
    // Every handler swallowed its error into a 500, so nothing ever threw,
    // onRequestError never fired, and no Sentry event was created. The only
    // signal was heartbeat silence — and HEARTBEAT_URL_BASE is commented out
    // in .env.example, so a cron failing daily was invisible.
    Sentry.captureException(e, { tags: { cron: "daily-digest" } });
    return err(`Cron failed: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
