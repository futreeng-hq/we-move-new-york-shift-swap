// Paths that must never depend on a session, on Redis, or on middleware at all.
//
// This exists because of a production failure mode found on 2026-09-27. The
// middleware force-logout check runs for every non-/api/ path, and when
// NODE_ENV is production and Redis cannot be reached it returns
//
//   503 {"error":"Session validation temporarily unavailable"}
//
// The old matcher excluded only _next/static, _next/image and favicon.ico, so
// for any signed-in user that 503 was also the response for /sw.js,
// /manifest.json and /icons/*. A hibernating Upstash instance therefore did not
// merely break login — it served JSON 503s for the service worker, the manifest
// and every icon, which is the PWA shell itself. The offline fallback that is
// supposed to cover exactly this kind of outage was taken out by the outage.
//
// Nothing in this list carries user data, so skipping the session check for
// them removes no guarantee. It also removes a Redis round-trip from every
// icon request for signed-in users, which on transit-station connectivity is
// the difference between an app that loads and one that hangs.
//
// The matcher in middleware.ts must stay in sync with isPublicAsset(). Next
// requires the matcher to be a static literal, so it cannot be generated from
// this file; test/publicAssets.test.ts asserts the two agree instead.

export const PUBLIC_ASSET_PATHS = [
  "/sw.js",
  "/manifest.json",
  "/robots.txt",
  "/favicon.ico",
  "/favicon.svg",
] as const;

export const PUBLIC_ASSET_PREFIXES = ["/icons/", "/logos/", "/_next/static/", "/_next/image"] as const;

/** Static file extensions served straight from public/. */
export const PUBLIC_ASSET_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "gif",
  "svg",
  "ico",
  "txt",
  "woff",
  "woff2",
] as const;

const EXT_RE = new RegExp(`\\.(?:${PUBLIC_ASSET_EXTENSIONS.join("|")})$`, "i");

export function isPublicAsset(pathname: string): boolean {
  if ((PUBLIC_ASSET_PATHS as readonly string[]).includes(pathname)) return true;
  if ((PUBLIC_ASSET_PREFIXES as readonly string[]).some((p) => pathname.startsWith(p))) return true;
  return EXT_RE.test(pathname);
}
