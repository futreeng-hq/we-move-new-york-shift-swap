/**
 * Redaction for URLs that carry a credential in the path.
 *
 * /reset-password/<jwt> and /verify-email/<token> put a live account-takeover
 * credential in the URL. Every analytics and error-reporting client on the page
 * records the URL by default, so without this the 1-hour reset JWT and the
 * 24-hour verification token were being written to Google Analytics, Vercel
 * Analytics and Sentry, where anyone with read access to those dashboards could
 * copy one and take over the account.
 *
 * Shared by lib/analytics.ts, the Vercel <Analytics> beforeSend hook, and all
 * three Sentry configs so the list lives in one place.
 */

/** Route prefixes whose next path segment is a credential. */
export const SENSITIVE_PATH_PREFIXES = ["/reset-password", "/verify-email"] as const;

export function isSensitivePath(pathname: string): boolean {
  return SENSITIVE_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Replaces the credential segment with a literal placeholder, keeping the route
 * itself so the page is still countable in analytics.
 */
export function redactSensitivePath(pathname: string): string {
  const prefix = SENSITIVE_PATH_PREFIXES.find(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  return prefix ? `${prefix}/[redacted]` : pathname;
}

/** Same, for an absolute URL. Query and fragment are dropped entirely. */
export function redactSensitiveUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!isSensitivePath(parsed.pathname)) return url;
    return `${parsed.origin}${redactSensitivePath(parsed.pathname)}`;
  } catch {
    // Relative path, or not a URL at all.
    return isSensitivePath(url.split("?")[0]) ? redactSensitivePath(url.split("?")[0]) : url;
  }
}
