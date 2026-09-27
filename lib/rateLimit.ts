// Distributed rate limiter using Upstash Redis.
//
// Behaviour when Redis is not usable — stated precisely, because the previous
// version of this comment said "falls back to allowing the request" while the
// code below fails CLOSED in production, and the next person to read it would
// have got it exactly backwards:
//
//   - Not configured (no URL/token): allow outside production, DENY in
//     production. A production deploy with no Redis has no rate limiting at
//     all, which is worse than a hard failure — lib/env.ts requires both vars
//     in production, so reaching this branch there means the env check was
//     bypassed.
//   - Configured but erroring: allow outside production, DENY in production,
//     and report to Sentry.

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

export type RedisHealth =
  | { state: "ok"; latencyMs: number }
  | { state: "not_configured" }
  | { state: "unreachable"; latencyMs: number };

/**
 * Liveness probe for the Redis dependency, for /api/health.
 *
 * Distinguishes "not configured" (dev, and any deploy without Upstash env set)
 * from "configured but unreachable" (a real outage). Callers decide the HTTP
 * consequence — this only reports.
 */
// A dead Upstash host takes ~4.3s to surface a connection error, which would
// stall every /api/health call for that long. Bound it: past this, the answer
// is "unreachable" regardless of what the socket eventually says.
const HEALTH_PING_TIMEOUT_MS = 2_000;

export async function redisHealth(): Promise<RedisHealth> {
  const store = getRedis();
  if (!store) return { state: "not_configured" };
  const started = Date.now();
  try {
    await Promise.race([
      store.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("health ping timeout")), HEALTH_PING_TIMEOUT_MS).unref(),
      ),
    ]);
    return { state: "ok", latencyMs: Date.now() - started };
  } catch {
    return { state: "unreachable", latencyMs: Date.now() - started };
  }
}

/**
 * Why this is not just a boolean any more.
 *
 * On 2026-09-27 the Upstash free-tier instance hibernated. Combined with the
 * fail-closed policy above, every login attempt came back
 *
 *   429 {"error":"Too many login attempts..."}
 *
 * which is a lie. Nobody was rate limited; the backend was asleep. The status
 * code told users they were being throttled and told whoever read the logs to
 * look for abuse, so the real cause — a sleeping cache — stayed hidden longer
 * than it should have. A 429 also invites clients to retry on a backoff, which
 * is exactly wrong for an outage that needs someone to wake the database.
 *
 * Callers that turn this into an HTTP response need to tell the two apart. The
 * decision to deny is unchanged: failing closed is still the policy.
 */
export type RateLimitOutcome =
  | { allowed: true }
  /** Over the limit. A real 429. */
  | { allowed: false; reason: "limited" }
  /** Redis missing or erroring. Denied by policy, but this is a 503. */
  | { allowed: false; reason: "unavailable" }
  /** No trustworthy client IP. Denied in production; stays a 429 (see below). */
  | { allowed: false; reason: "unattributable" };

const ALLOWED: RateLimitOutcome = { allowed: true };

/**
 * Returns the outcome with its reason. `rateLimit()` wraps this for the many
 * call sites that only need the boolean.
 * @param key      Unique key (e.g. "login:1.2.3.4")
 * @param limit    Max requests allowed in the window
 * @param windowMs Window size in milliseconds
 */
export async function rateLimitStatus(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitOutcome> {
  try {
    const store = getRedis();
    if (!store) {
      // Previously `return true` unconditionally, so a production deploy that
      // lost its Upstash env vars silently disabled every rate limit in the
      // app — login, register, forgot-password, reports, the lot — with nothing
      // anywhere saying so.
      if (process.env.NODE_ENV === "production") {
        console.error("[rateLimit] Upstash is not configured in production — failing closed for key", key);
        return { allowed: false, reason: "unavailable" };
      }
      return ALLOWED;
    }
    const windowSec = Math.ceil(windowMs / 1000);
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, windowSec);
    return count <= limit ? ALLOWED : { allowed: false, reason: "limited" };
  } catch (e) {
    // Fails CLOSED in production (see the header comment) and open elsewhere.
    console.error("[rateLimit] Redis error — failing closed in production for key", key, e);
    if (process.env.NODE_ENV === "production") {
      try {
        const Sentry = await import("@sentry/nextjs");
        Sentry.captureException(e, {
          level: "warning",
          tags: { source: "rateLimit" },
          extra: { key },
        });
      } catch {
        // Don't let Sentry import failure break the rate limiter
      }
    }
    if (process.env.NODE_ENV === "production") return { allowed: false, reason: "unavailable" };
    return ALLOWED;
  }
}

/** Boolean form, for the call sites that only gate an action. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  return (await rateLimitStatus(key, limit, windowMs)).allowed;
}

/**
 * Map an outcome onto a response. Keeps the 429/503 split in one place so it
 * cannot drift between routes.
 *
 * `unattributable` deliberately stays a 429 rather than becoming a 400 or 503.
 * On Vercel it only trips on genuinely malformed forwarding headers, and a
 * distinct status there would hand an attacker a signal for which requests the
 * limiter could not attribute.
 */
export function rateLimitResponse(outcome: RateLimitOutcome, limitedMessage: string): Response {
  if (outcome.allowed) throw new Error("rateLimitResponse called on an allowed outcome");
  if (outcome.reason === "unavailable") {
    return Response.json(
      { error: "Service temporarily unavailable. Please try again in a moment." },
      // Retry-After is the honest instruction: this is transient and on our
      // side. A 429's implied "you did too much" is not true here.
      { status: 503, headers: { "retry-after": "30" } },
    );
  }
  return Response.json({ error: limitedMessage }, { status: 429 });
}

// Number of proxies in front of this app that append to X-Forwarded-For.
// On Vercel this must stay 0: Vercel's edge *overwrites* X-Forwarded-For with
// the true client IP and does not forward client-supplied values, so the
// leftmost entry is trustworthy. Set this only if you put another proxy
// (Cloudflare, an ALB, an nginx ingress) in front, or enable Vercel's
// Enterprise "trusted proxy" mode — in both cases the client controls the
// leftmost entries and only the Nth-from-the-right hop is attacker-proof.
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Syntactic IP validation — rejects header junk before it becomes a bucket key.
 *
 * The old IPv6 branch was `v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v)`, which
 * accepted ":", "1:2", "a:b" and "::::". That is not pedantry: every distinct
 * string is a distinct Redis bucket, so an attacker who can influence the
 * chosen header walks "1:1", "1:2", "1:3"… and gets unlimited fresh
 * login/register/forgot-password counters. Now uses the platform parser.
 */
function isValidIp(v: string): boolean {
  if (!v || v.length > 45) return false;
  if (IPV4.test(v)) return v.split(".").every((o) => Number(o) <= 255);
  if (!v.includes(":")) return false;
  // URL is the only structural IPv6 parser available in both the node and edge
  // runtimes. It normalizes and rejects malformed literals.
  try {
    const u = new URL(`http://[${v}]`);
    return u.hostname.startsWith("[") && u.hostname.endsWith("]");
  } catch {
    return false;
  }
}

/**
 * Rate-limit against a source IP, with an explicit policy for un-attributable
 * requests. In production a request we cannot tie to a verified IP is denied
 * (fail closed) — on Vercel X-Forwarded-For is always present, so this only
 * trips on genuinely malformed traffic. Outside production nothing sets the
 * header, so it degrades to allow rather than blocking all local development.
 *
 * Prefer this over interpolating clientIp() into a key yourself: `${null}`
 * stringifies to "null" and silently rebuilds the shared-bucket bug.
 */
export async function rateLimitByIp(
  ip: string | null,
  prefix: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  return (await rateLimitStatusByIp(ip, prefix, limit, windowMs)).allowed;
}

/** Outcome-returning form of rateLimitByIp, for routes that render 429 vs 503. */
export async function rateLimitStatusByIp(
  ip: string | null,
  prefix: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitOutcome> {
  if (ip === null) {
    return process.env.NODE_ENV === "production"
      ? { allowed: false, reason: "unattributable" }
      : ALLOWED;
  }
  return rateLimitStatus(`${prefix}:${ip}`, limit, windowMs);
}

/**
 * Extract the client IP for rate-limit bucketing.
 *
 * Returns null when no trustworthy IP can be established. Callers must decide
 * the policy for that case explicitly — it deliberately does not collapse to a
 * shared "unknown" bucket, which let every un-attributable request share one
 * counter and gave an attacker a way to exhaust it for everyone.
 */
export function clientIp(req: Request): string | null {
  // Vercel sets this to the true client IP on every request and does not let a
  // client forge it — unlike X-Forwarded-For, whose leftmost entry is only
  // trustworthy while nothing else sits in front of this app. Preferring it
  // means the limiter stays correct even if Cloudflare or an ALB is added later
  // without anyone remembering to set TRUSTED_PROXY_HOPS. Absent off Vercel,
  // where the X-Forwarded-For logic below still applies.
  const vercelIp = req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim();
  if (vercelIp && isValidIp(vercelIp)) return vercelIp;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    // Count from the right: those entries were appended by infrastructure we
    // control and cannot be forged by the client. Anything left of that is
    // client-supplied and is discarded.
    const idx = TRUSTED_PROXY_HOPS > 0 ? hops.length - 1 - TRUSTED_PROXY_HOPS : 0;
    const candidate = hops[idx];
    if (candidate && isValidIp(candidate)) return candidate;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp && isValidIp(realIp)) return realIp;
  return null;
}
