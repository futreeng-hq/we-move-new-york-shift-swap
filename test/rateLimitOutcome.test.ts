import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rateLimitStatus, rateLimitStatusByIp, rateLimitResponse } from "../lib/rateLimit";

// The 2026-09-27 incident, encoded.
//
// The Upstash free-tier instance hibernated. The limiter fails closed in
// production, so every login returned 429 "Too many attempts" — nobody was
// throttled, the cache was asleep. The status code misdirected both the users
// (who were told to wait) and whoever read the logs (who went looking for
// abuse). The deny is correct; the label was not.

const origNodeEnv = process.env.NODE_ENV;
const origUrl = process.env.UPSTASH_REDIS_REST_URL;
const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

function setEnv(nodeEnv: string | undefined, url?: string, token?: string) {
  if (nodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
  else (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  if (url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = url;
  if (token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = token;
}

afterEach(() => setEnv(origNodeEnv, origUrl, origToken));

test("no Redis in production denies as unavailable, not as limited", async () => {
  setEnv("production");
  const outcome = await rateLimitStatus("login:1.2.3.4", 10, 60_000);
  assert.equal(outcome.allowed, false, "fail-closed policy is unchanged");
  assert.equal(
    outcome.allowed === false && outcome.reason,
    "unavailable",
    'a missing or sleeping Redis must report "unavailable" — reporting "limited" is what produced the misleading 429'
  );
});

test("no Redis outside production still allows, so local dev works", async () => {
  setEnv("development");
  const outcome = await rateLimitStatus("login:1.2.3.4", 10, 60_000);
  assert.equal(outcome.allowed, true);
});

test("an unattributable IP is denied in production and allowed outside it", async () => {
  setEnv("production", "https://example.upstash.io", "t");
  const prod = await rateLimitStatusByIp(null, "login", 10, 60_000);
  assert.equal(prod.allowed, false);
  assert.equal(prod.allowed === false && prod.reason, "unattributable");

  setEnv("development");
  const dev = await rateLimitStatusByIp(null, "login", 10, 60_000);
  assert.equal(dev.allowed, true);
});

// ─── Status mapping ──────────────────────────────────────────────────────────

test("unavailable becomes a 503 with Retry-After and no throttling language", async () => {
  const res = rateLimitResponse({ allowed: false, reason: "unavailable" }, "Too many attempts");
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "30");
  const body = (await res.json()) as { error: string };
  assert.ok(
    !/too many/i.test(body.error),
    "an outage must not tell the user they did too much — that was the original bug"
  );
  assert.match(body.error, /temporarily unavailable/i);
});

test("limited becomes a 429 carrying the caller's message", async () => {
  const res = rateLimitResponse({ allowed: false, reason: "limited" }, "Too many attempts — try again in a minute");
  assert.equal(res.status, 429);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "Too many attempts — try again in a minute");
});

// Deliberate: a distinct status here would tell an attacker which requests the
// limiter could not attribute to an IP.
test("unattributable stays a 429, indistinguishable from a real limit hit", async () => {
  const res = rateLimitResponse({ allowed: false, reason: "unattributable" }, "Too many attempts");
  assert.equal(res.status, 429);
});

test("calling rateLimitResponse on an allowed outcome is a programming error", () => {
  assert.throws(() => rateLimitResponse({ allowed: true }, "x"), /allowed outcome/);
});

// ─── The auth routes must use the outcome form ───────────────────────────────

test("auth routes render 429/503 through rateLimitResponse", async () => {
  const { readFileSync } = await import("node:fs");
  const routes = [
    "app/api/auth/login/route.ts",
    "app/api/auth/register/route.ts",
    "app/api/auth/forgot-password/route.ts",
    "app/api/auth/reset-password/route.ts",
    "app/api/auth/resend-verification/route.ts",
  ];
  for (const r of routes) {
    const src = readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
    assert.ok(
      src.includes("rateLimitStatusByIp"),
      `${r} must use rateLimitStatusByIp so it can tell a limit from an outage`
    );
    assert.ok(
      src.includes("rateLimitResponse"),
      `${r} must render the outcome through rateLimitResponse`
    );
    assert.ok(
      !/return err\([^)]*429\)/.test(src),
      `${r} still hard-codes a 429 — that is the path that lied during the Redis outage`
    );
  }
});

// An outage denying every login would otherwise flood Sentry with events that
// read like a credential-stuffing attack, burying the real cause.
test("auth routes only report an abuse signal on a real limit hit", async () => {
  const { readFileSync } = await import("node:fs");
  for (const r of [
    "app/api/auth/login/route.ts",
    "app/api/auth/register/route.ts",
    "app/api/auth/forgot-password/route.ts",
    "app/api/auth/reset-password/route.ts",
    "app/api/auth/resend-verification/route.ts",
  ]) {
    const src = readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
    assert.match(
      src,
      /rl\.reason === "limited"/,
      `${r} must gate its "rate limit hit" Sentry event on reason === "limited"`
    );
  }
});
