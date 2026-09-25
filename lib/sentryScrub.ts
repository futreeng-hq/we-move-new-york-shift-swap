import { redactSensitiveUrl, redactSensitiveText } from "@/lib/sensitiveUrl";

/**
 * Shared Sentry beforeSend scrubbing for the client, server and edge configs.
 *
 * The previous per-config helper walked only the TOP level of request.data,
 * extra and contexts, so a nested { user: { email } } passed straight through,
 * and request.url, query_string, headers and cookies were never touched at all
 * — which is how the /reset-password/<jwt> URL reached Sentry.
 */

const SENSITIVE_KEYS =
  /^(password|passwordhash|new_?password|current_?password|token|access_?token|refresh_?token|reset_?token|authorization|cookie|set-cookie|secret|api_?key|email|contact|phone)$/i;

const MAX_DEPTH = 6;

/** Recursively replaces sensitive values, preserving structure. */
export function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.test(key) ? "[Filtered]" : scrubDeep(val, depth + 1);
  }
  return out;
}

/**
 * Applies to any Sentry event shape. Typed loosely on purpose so the same
 * function serves @sentry/nextjs's client, server and edge Event types.
 */
export function scrubEvent<T extends Record<string, unknown>>(event: T): T {
  const e = event as Record<string, unknown>;

  const request = e.request as Record<string, unknown> | undefined;
  if (request) {
    if (typeof request.url === "string") request.url = redactSensitiveUrl(request.url);
    // Dropped wholesale: neither is needed to diagnose an error, and both are
    // common carriers of tokens and session cookies.
    delete request.query_string;
    delete request.cookies;
    if (request.headers && typeof request.headers === "object") {
      request.headers = scrubDeep(request.headers);
    }
    if (request.data && typeof request.data === "object") {
      request.data = scrubDeep(request.data);
    }
  }

  if (e.extra && typeof e.extra === "object") e.extra = scrubDeep(e.extra);
  if (e.contexts && typeof e.contexts === "object") e.contexts = scrubDeep(e.contexts);
  if (e.tags && typeof e.tags === "object") e.tags = scrubDeep(e.tags);

  // A Prisma validation error embeds the failing `data` object — including
  // passwordHash — in its message, which no key-based scrubber can see.
  if (typeof e.message === "string") e.message = redactSensitiveText(e.message);
  const exception = e.exception as { values?: Array<{ value?: string }> } | undefined;
  if (exception?.values) {
    for (const v of exception.values) {
      if (typeof v.value === "string") v.value = redactSensitiveText(v.value);
    }
  }

  return event;
}
