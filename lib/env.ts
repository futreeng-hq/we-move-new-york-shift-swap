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

  return { ok: problems.length === 0, problems };
}

/** Throws on invalid environment. Called at startup from instrumentation.ts. */
export function assertEnv(env: EnvLike = process.env): void {
  const { ok, problems } = validateEnv(env);
  if (ok) return;

  const detail = problems.map((p) => `  • ${p}`).join("\n");
  throw new Error(
    `Invalid environment — refusing to start.\n\n${detail}\n\n` +
      `See .env.example for the full list. Values are never printed here.\n`,
  );
}
