import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEnv, assertEnv, type EnvLike } from "../lib/env";

// Pure — no DB, no network. Runs everywhere.

const SECRET = "x".repeat(32);

const minimalDev = {
  DATABASE_URL: "postgresql://u:p@host:5432/db",
  JWT_SECRET: SECRET,
  JWT_REFRESH_SECRET: SECRET,
  JWT_RESET_SECRET: SECRET,
};

const fullProd = {
  ...minimalDev,
  NEXT_PUBLIC_APP_URL: "https://wmnyshiftswap.com",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "We Move NY <noreply@wmnyshiftswap.com>",
  CRON_SECRET: "cron",
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_EMAIL: "mailto:admin@wmnyshiftswap.com",
  UPSTASH_REDIS_REST_URL: "https://db.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok",
};

test("dev needs only the always-required vars", () => {
  assert.equal(validateEnv(minimalDev, false).ok, true);
});

test("production additionally requires the production-only vars", () => {
  const r = validateEnv(minimalDev, true);
  assert.equal(r.ok, false);
  // Every production-only var should be reported, not just the first.
  assert.ok(r.problems.some((p) => p.startsWith("CRON_SECRET")));
  assert.ok(r.problems.some((p) => p.startsWith("UPSTASH_REDIS_REST_URL")));
  assert.equal(validateEnv(fullProd, true).ok, true);
});

test("missing and empty/whitespace-only values are both rejected", () => {
  for (const bad of [undefined, "", "   "]) {
    const env = { ...minimalDev, JWT_SECRET: bad };
    const r = validateEnv(env, false);
    assert.equal(r.ok, false, `JWT_SECRET=${JSON.stringify(bad)} should fail`);
    assert.ok(r.problems.some((p) => p.includes("JWT_SECRET is missing")));
  }
});

test("shape checks: DATABASE_URL scheme, secret length, URL validity", () => {
  const badScheme = validateEnv({ ...minimalDev, DATABASE_URL: "mysql://h/db" }, false);
  assert.ok(badScheme.problems.some((p) => p.includes("postgresql://")));

  const shortSecret = validateEnv({ ...minimalDev, JWT_SECRET: "tooshort" }, false);
  assert.ok(shortSecret.problems.some((p) => p.includes("at least 32 characters")));

  const badUrl = validateEnv({ ...fullProd, NEXT_PUBLIC_APP_URL: "wmnyshiftswap.com" }, true);
  assert.ok(badUrl.problems.some((p) => p.includes("absolute URL")));
});

test("TRUSTED_PROXY_HOPS: optional, but garbage is rejected", () => {
  // Absent and empty are fine — the default (0) is the Vercel posture.
  assert.equal(validateEnv(minimalDev, false).ok, true);
  assert.equal(validateEnv({ ...minimalDev, TRUSTED_PROXY_HOPS: "" }, false).ok, true);
  assert.equal(validateEnv({ ...minimalDev, TRUSTED_PROXY_HOPS: "0" }, false).ok, true);
  assert.equal(validateEnv({ ...minimalDev, TRUSTED_PROXY_HOPS: "2" }, false).ok, true);
  // A NaN here would silently change which XFF hop is trusted.
  for (const bad of ["abc", "-1", "1.5"]) {
    const r = validateEnv({ ...minimalDev, TRUSTED_PROXY_HOPS: bad }, false);
    assert.equal(r.ok, false, `TRUSTED_PROXY_HOPS=${bad} should fail`);
  }
});

test("assertEnv throws listing every problem, and never leaks a value", () => {
  const leaky = {
    ...minimalDev,
    DATABASE_URL: "postgresql://admin:SUPERSECRETPASSWORD@host:5432/db",
    JWT_SECRET: "SHORTSECRETVALUE",
  };

  assert.throws(
    () => assertEnv(leaky),
    (e: Error) => {
      assert.ok(e.message.includes("JWT_SECRET"), "names the offending variable");
      assert.ok(!e.message.includes("SUPERSECRETPASSWORD"), "must not echo a connection string");
      assert.ok(!e.message.includes("SHORTSECRETVALUE"), "must not echo a secret value");
      return true;
    },
  );

  assert.doesNotThrow(() => assertEnv(minimalDev));
});

// ─── Warnings: real defects that must not stop a boot ────────────────────────
//
// Added 2026-09-27. These three were open punch-list items checked by hand in a
// dashboard; they are boot-time assertions now. All are warnings rather than
// problems on purpose: every one of them is live in production today, so
// promoting any to a hard failure would turn the next deploy into an outage.

const PROD_OK: EnvLike = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://u:p@h/db?sslmode=verify-full",
  JWT_SECRET: "x".repeat(32),
  JWT_REFRESH_SECRET: "x".repeat(32),
  JWT_RESET_SECRET: "x".repeat(32),
  NEXT_PUBLIC_APP_URL: "https://www.wmnyshiftswap.com",
  RESEND_API_KEY: "re_live",
  EMAIL_FROM: "WMNY <noreply@wmnyshiftswap.com>",
  CRON_SECRET: "c".repeat(32),
  VAPID_PUBLIC_KEY: "vp",
  VAPID_PRIVATE_KEY: "vs",
  VAPID_EMAIL: "mailto:ops@wmnyshiftswap.com",
  UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "t",
  HEARTBEAT_URL_BASE: "https://hc-ping.com/abc",
};

test("a fully configured production env has no problems and no warnings", () => {
  const r = validateEnv(PROD_OK);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, true);
});

test("warnings never make the environment invalid", () => {
  const r = validateEnv({ ...PROD_OK, HEARTBEAT_URL_BASE: undefined });
  assert.equal(r.ok, true, "a warning must not stop the process from booting");
  assert.ok(r.warnings.some((w) => w.includes("HEARTBEAT_URL_BASE")));
});

test("sslmode is warned about when absent or weaker than verify-full", () => {
  const none = validateEnv({ ...PROD_OK, DATABASE_URL: "postgresql://u:p@h/db" });
  assert.ok(none.warnings.some((w) => w.includes("no sslmode")), "absent sslmode must warn");

  const req = validateEnv({ ...PROD_OK, DATABASE_URL: "postgresql://u:p@h/db?sslmode=require" });
  assert.ok(
    req.warnings.some((w) => w.includes("sslmode=require")),
    "sslmode=require must warn — pg v9 stops verifying the server certificate for it"
  );
});

test("the apex app URL is warned about because it 308s to www", () => {
  const apex = validateEnv({ ...PROD_OK, NEXT_PUBLIC_APP_URL: "https://wmnyshiftswap.com" });
  assert.ok(apex.warnings.some((w) => w.includes("apex host")));

  const www = validateEnv({ ...PROD_OK, NEXT_PUBLIC_APP_URL: "https://www.wmnyshiftswap.com" });
  assert.equal(www.warnings.length, 0, "the canonical host must be silent");
});

test("a trailing path on the app URL is warned about", () => {
  const r = validateEnv({ ...PROD_OK, NEXT_PUBLIC_APP_URL: "https://www.wmnyshiftswap.com/" });
  assert.ok(r.warnings.some((w) => w.includes("trailing slash")));
});

test("a placeholder sender address is warned about", () => {
  const r = validateEnv({ ...PROD_OK, EMAIL_FROM: "onboarding@resend.dev" });
  assert.ok(r.warnings.some((w) => w.includes("resend.dev")));
});

test("non-production environments get no warnings at all", () => {
  const r = validateEnv({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://u:p@localhost/db",
    JWT_SECRET: "x".repeat(32),
    JWT_REFRESH_SECRET: "x".repeat(32),
    JWT_RESET_SECRET: "x".repeat(32),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, [], "local dev must not be nagged about production-only config");
});
