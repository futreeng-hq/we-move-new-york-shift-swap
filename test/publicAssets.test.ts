import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPublicAsset } from "../lib/publicAssets";

// The regression this file guards.
//
// middleware.ts returns 503 for every non-/api/ path when NODE_ENV is
// production and Redis is unreachable. Before 2026-09-27 the matcher excluded
// only _next/static, _next/image and favicon.ico, so a signed-in user hitting a
// hibernating Upstash instance got that JSON 503 for /sw.js, /manifest.json and
// /icons/* as well — the PWA shell, including the offline fallback that exists
// to survive precisely this outage.

const SHELL = ["/sw.js", "/manifest.json", "/icons/icon-192.png", "/icons/badge-72.png", "/favicon.svg"];

for (const p of SHELL) {
  test(`${p} is a public asset and never reaches the session check`, () => {
    assert.equal(isPublicAsset(p), true);
  });
}

test("app routes are NOT public assets — the session check must still run", () => {
  for (const p of ["/", "/login", "/depots", "/depot/jackie-gleason", "/profile", "/s/abc123", "/admin/reports"]) {
    assert.equal(isPublicAsset(p), false, `${p} must stay behind middleware`);
  }
});

test("api routes are not treated as public assets", () => {
  for (const p of ["/api/health", "/api/auth/login", "/api/push/subscribe"]) {
    assert.equal(isPublicAsset(p), false, `${p} must not be short-circuited here`);
  }
});

// A page route that merely *contains* an asset-looking word must not slip
// through. This is the failure mode of a loose extension check.
test("extension matching is anchored to the end of the path", () => {
  assert.equal(isPublicAsset("/depot/not-an-image.png/secret"), false);
  assert.equal(isPublicAsset("/svg"), false);
  assert.equal(isPublicAsset("/logo.png"), true);
});

// ─── Matcher / predicate agreement ───────────────────────────────────────────
//
// Next needs config.matcher to be a static literal, so it cannot be built from
// lib/publicAssets.ts. Extract it from the source and check both sides classify
// the same paths the same way.

function middlewareMatcher(): RegExp {
  const src = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  const m = src.match(/matcher:\s*\[\s*"([^"]+)"/);
  assert.ok(m, "could not find config.matcher in middleware.ts");
  // The matcher is a path pattern; anchor it the way Next does.
  return new RegExp(`^${m[1].replace(/\\\\/g, "\\")}$`);
}

test("the middleware matcher excludes exactly what isPublicAsset() excludes", () => {
  const re = middlewareMatcher();
  const paths = [
    ...SHELL,
    "/robots.txt",
    "/logo.png",
    "/bus-logo.png",
    "/logos/twu.svg",
    "/_next/static/chunks/main.js",
    "/",
    "/login",
    "/depots",
    "/profile",
    "/api/health",
    "/api/auth/login",
    "/depot/jackie-gleason",
  ];

  for (const p of paths) {
    const matcherRuns = re.test(p);
    const shortCircuits = isPublicAsset(p);
    // Anything isPublicAsset() would short-circuit must not be matched at all,
    // so middleware is never even invoked for it.
    if (shortCircuits) {
      assert.equal(matcherRuns, false, `${p}: isPublicAsset() says asset, but the matcher still runs middleware`);
    }
  }
});

test("the matcher still covers the routes that need the force-logout check", () => {
  const re = middlewareMatcher();
  for (const p of ["/", "/login", "/depots", "/profile", "/s/abc123", "/admin/reports", "/api/auth/login"]) {
    assert.equal(re.test(p), true, `${p} must still run middleware`);
  }
});
