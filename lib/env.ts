// Startup environment validation.
//
// Called from instrumentation.ts `register()`, which Next.js runs once per
// server boot (and during `next build`). A missing or malformed required
// variable throws there, so the process dies at startup with one clear message
// instead of surfacing later as a 500 on whichever route happened to need it.
//
// No zod: these are presence and shape checks, and zod would be a new runtime
// dependency for ~40 lines of logic. If richer parsing is ever needed
// (coercion, nested config), revisit.
//
// IMPORTANT: never log a variable's *value* here. Errors name the variable and
// describe the expected shape only — this output reaches CI logs and Sentry.

/** Just the shape we read — avoids NodeJS.ProcessEnv, which requires NODE_ENV. */
export type EnvLike = Record<string, string | undefined>;

type Requirement = "always" | "production";

interface Spec {
  name: string;
  required: Requirement;
  describe: string;
  /** Optional shape check. Return an error string, or null when valid. */
  check?: (value: string) => string | null;
}

const MIN_SECRET_LENGTH = 32;

const secretCheck = (v: string): string | null =>
  v.length < MIN_SECRET_LENGTH
    ? `must be at least ${MIN_SECRET_LENGTH} characters (generate with: openssl rand -base64 64)`
    : null;

const urlCheck = (v: string): string | null => {
  try {
    new URL(v);
    return null;
  } catch {
    return "must be an absolute URL including scheme (https://…)";
  }
};

const SPECS: Spec[] = [
  // ── Always required: the app cannot serve a request without these ────────
  {
    name: "DATABASE_URL",
    required: "always",
    describe: "PostgreSQL connection string",
    check: (v) =>
      /^postgres(ql)?:\/\//.test(v) ? null : "must start with postgresql:// or postgres://",
  },
  { name: "JWT_SECRET", required: "always", describe: "signs access tokens", check: secretCheck },
  { name: "JWT_REFRESH_SECRET", required: "always", describe: "signs refresh tokens", check: secretCheck },
  { name: "JWT_RESET_SECRET", required: "always", describe: "signs password-reset tokens", check: secretCheck },

  // ── Production only: dev and test run without these ──────────────────────
  { name: "NEXT_PUBLIC_APP_URL", required: "production", describe: "base URL for emails and push deep-links", check: urlCheck },
  { name: "RESEND_API_KEY", required: "production", describe: "transactional email (verification, password reset)" },
  { name: "EMAIL_FROM", required: "production", describe: "From: header on outbound mail" },
  { name: "CRON_SECRET", required: "production", describe: "authenticates Vercel Cron requests; crons 401 without it" },
  { name: "VAPID_PUBLIC_KEY", required: "production", describe: "Web Push keypair (npx web-push generate-vapid-keys)" },
  { name: "VAPID_PRIVATE_KEY", required: "production", describe: "Web Push keypair" },
  { name: "VAPID_EMAIL", required: "production", describe: "mailto: contact for the push service" },
  { name: "UPSTASH_REDIS_REST_URL", required: "production", describe: "rate limiting and token revocation", check: urlCheck },
  { name: "UPSTASH_REDIS_REST_TOKEN", required: "production", describe: "rate limiting and token revocation" },
];

export interface ValidationResult {
  ok: boolean;
  problems: string[];
  /**
   * Misconfigurations that are real but must NOT stop the process.
   *
   * The distinction matters. A missing JWT_SECRET means nothing can work, so
   * failing to boot is the kindest outcome. But `sslmode` absent from an
   * otherwise working DATABASE_URL, or NEXT_PUBLIC_APP_URL pointing at the apex
   * instead of www, are both live in production right now — promoting either to
   * a `problem` would turn the next deploy into an outage over a config nit.
   * These are surfaced loudly at boot and left for someone to fix deliberately.
   */
  warnings: string[];
}

/**
 * Checks that produce warnings rather than boot failures. Split out from SPECS
 * because the consequence is different, not because the findings are minor.
 */
function collectWarnings(env: EnvLike, isProduction: boolean): string[] {
  const warnings: string[] = [];
  if (!isProduction) return warnings;

  // `pg` currently treats sslmode=require as verify-full, but v9 adopts libpq
  // semantics where `require` encrypts WITHOUT verifying the server
  // certificate — i.e. no protection against an active MITM. Spelling
  // verify-full out now means the upgrade is a non-event instead of a silent
  // downgrade. Neon emits a deprecation warning for exactly this.
  const db = env.DATABASE_URL?.trim();
  if (db && !/[?&]sslmode=verify-full(&|$)/.test(db)) {
    const mode = db.match(/[?&]sslmode=([^&]+)/)?.[1];
    warnings.push(
      mode
        ? `DATABASE_URL has sslmode=${mode} — set sslmode=verify-full explicitly before pg v9, where "require" stops verifying the server certificate`
        : "DATABASE_URL has no sslmode — set sslmode=verify-full explicitly (pg currently defaults to it, pg v9 will not)"
    );
  }

  // The apex 308-redirects to www. Every verification and password-reset link
  // is built from this value, so an apex setting costs each of them an extra
  // round trip and drops the referrer on some clients.
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      if (u.protocol !== "https:") {
        warnings.push("NEXT_PUBLIC_APP_URL is not https — email and push links will be insecure");
      }
      if (/^wmnyshiftswap\.com$/i.test(u.hostname)) {
        warnings.push(
          "NEXT_PUBLIC_APP_URL is the apex host — it 308-redirects to www.wmnyshiftswap.com, so every verification and reset link takes an extra hop. Use the www host."
        );
      }
      // Checked on the raw string, not u.pathname: a trailing slash normalizes
      // to pathname "/" and becomes invisible to the parser, while the raw
      // value is what gets concatenated into `${APP_URL}/reset-password/...`
      // and produces a double slash in the emailed link.
      if (appUrl.endsWith("/")) {
        warnings.push("NEXT_PUBLIC_APP_URL has a trailing slash — links built from it will contain a double slash");
      } else if (u.pathname !== "/") {
        warnings.push("NEXT_PUBLIC_APP_URL should be an origin with no path");
      }
    } catch {
      /* shape already reported as a problem by urlCheck */
    }
  }

  // A cron that fails never pings, and silence is the alarm — but only if
  // something is listening. Unset, the entire cron failure-detection story is
  // "nobody finds out".
  if (!env.HEARTBEAT_URL_BASE?.trim()) {
    warnings.push(
      "HEARTBEAT_URL_BASE is unset — a failing or never-registered cron job produces no alert anywhere. All six crons are daily; configure dead-man periods to match."
    );
  }

  // Deliverability depends on this matching a verified sending domain. Catching
  // the onboarding placeholder is worth the two lines.
  const from = env.EMAIL_FROM?.trim();
  if (from && /@resend\.dev>?$/i.test(from)) {
    warnings.push(
      "EMAIL_FROM is still a @resend.dev address — mail will send but not from your verified domain, which hurts deliverability"
    );
  }

  return warnings;
}

/** Pure: check a given environment. Exported for tests. */
export function validateEnv(
  env: EnvLike = process.env,
  // VERCEL_ENV, not NODE_ENV, is the discriminator on Vercel: NODE_ENV is
  // "production" on preview deployments too. Gating on NODE_ENV made
  // assertEnv() throw at boot on every preview, because lib/appUrl.ts
  // deliberately omits NEXT_PUBLIC_APP_URL there and falls back to VERCEL_URL —
  // a fallback that was unreachable as long as the boot check rejected it
  // first. Off Vercel (local, CI, Docker) VERCEL_ENV is unset, so this keeps
  // the old NODE_ENV behavior.
  isProduction = env.VERCEL_ENV
    ? env.VERCEL_ENV === "production"
    : env.NODE_ENV === "production",
): ValidationResult {
  const problems: string[] = [];

  for (const spec of SPECS) {
    if (spec.required === "production" && !isProduction) continue;

    const raw = env[spec.name];
    if (raw === undefined || raw.trim() === "") {
      problems.push(`${spec.name} is missing — ${spec.describe}`);
      continue;
    }
    const shapeError = spec.check?.(raw.trim());
    if (shapeError) problems.push(`${spec.name} ${shapeError}`);
  }

  // TRUSTED_PROXY_HOPS is optional, but a malformed value silently changes
  // which X-Forwarded-For hop is trusted — a security-relevant default. Reject
  // it loudly rather than letting Number() coerce it to NaN.
  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops !== undefined && hops.trim() !== "") {
    const n = Number(hops);
    if (!Number.isInteger(n) || n < 0) {
      problems.push("TRUSTED_PROXY_HOPS must be a non-negative integer (0 on Vercel)");
    }
  }

  return { ok: problems.length === 0, problems, warnings: collectWarnings(env, isProduction) };
}

/**
 * Throws on invalid environment; logs warnings. Called at startup from
 * instrumentation.ts.
 *
 * Warnings are printed before the throw so that a boot which is about to fail
 * still reports everything wrong in one pass — otherwise you fix one variable,
 * redeploy, and discover the next.
 */
export function assertEnv(env: EnvLike = process.env): void {
  const { ok, problems, warnings } = validateEnv(env);

  if (warnings.length > 0) {
    console.warn(
      `[env] ${warnings.length} configuration warning(s) — not fatal, but each one is a real defect:\n` +
        warnings.map((w) => `  • ${w}`).join("\n"),
    );
  }

  if (ok) return;

  const detail = problems.map((p) => `  • ${p}`).join("\n");
  throw new Error(
    `Invalid environment — refusing to start.\n\n${detail}\n\n` +
      `See .env.example for the full list. Values are never printed here.\n`,
  );
}
