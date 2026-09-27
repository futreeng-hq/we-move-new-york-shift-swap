import { Redis } from "@upstash/redis";
import { nyToday } from "@/lib/nyDate";

/**
 * Once-per-day guard for crons whose work is not idempotent.
 *
 * Vercel cron delivery is at-least-once, so a retry after a timeout or a
 * transient 500 re-runs the whole handler. For expire-swaps that is harmless
 * (the query filters on what it already changed), but expiring-soon and
 * daily-digest send notifications, and a retry notifies every recipient twice.
 *
 * Keyed on the New York calendar date, not UTC, so it lines up with the window
 * the crons themselves compute.
 */

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

const MARKER_TTL_SECONDS = 36 * 60 * 60; // outlives the day, expires well before the next

/**
 * Claims today's run for `slug`. Returns true if the caller should proceed,
 * false if today's run already happened.
 *
 * Fails OPEN — a Redis problem must not silently stop the daily digest. The
 * cost of being wrong that way is a duplicate notification; the cost of failing
 * closed is operators never hearing that their swap expires tomorrow.
 */
export async function claimDailyRun(slug: string): Promise<boolean> {
  const store = getRedis();
  if (!store) return true;

  const day = nyToday().toISOString().slice(0, 10);
  try {
    // NX makes this atomic: two concurrent deliveries cannot both win.
    const res = await store.set(`cron-ran:${slug}:${day}`, "1", {
      nx: true,
      ex: MARKER_TTL_SECONDS,
    });
    return res === "OK";
  } catch {
    return true;
  }
}
