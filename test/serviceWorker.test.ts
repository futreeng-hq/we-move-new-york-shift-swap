import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// scripts/stamp-sw.mjs rewrites this exact line during the Vercel build so each
// deploy gets its own cache and `activate` drops the previous one. If the line's
// shape changes the stamper exits non-zero — but only at build time, on Vercel.
// Catch it here instead.
test("public/sw.js keeps the CACHE_NAME line shape the stamper matches", () => {
  const sw = read("public/sw.js");
  const line = /^const CACHE_NAME = "[^"]*";$/m;
  assert.ok(
    line.test(sw),
    'public/sw.js must contain a single-line `const CACHE_NAME = "...";`. ' +
      "scripts/stamp-sw.mjs rewrites it per deploy; without it the stale-shell bug returns."
  );
  const stamper = read("scripts/stamp-sw.mjs");
  assert.ok(
    stamper.includes('const CACHE_NAME = "[^"]*";'),
    "scripts/stamp-sw.mjs no longer matches on that line — the two have drifted"
  );
});

test("the build actually runs the stamp step", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(
    pkg.scripts["vercel-build"],
    /stamp-sw\.mjs/,
    "vercel-build must run scripts/stamp-sw.mjs, or CACHE_NAME ships as the dev literal on every deploy"
  );
  assert.match(
    pkg.scripts["vercel-build"],
    /stamp-sw\.mjs[\s\S]*next build/,
    "the stamp has to happen before next build"
  );
});

// cache.addAll() rejects as a unit. /depots redirects for a signed-out visitor,
// which is enough to fail the whole install — and a failed install means no
// service worker at all: no offline shell, no push. This was live.
test("install caches shell URLs individually, not with addAll", () => {
  // Strip line comments first — this file explains addAll() in prose, and a
  // naive search would match the explanation instead of the code.
  const sw = read("public/sw.js")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
  assert.ok(
    !/\.addAll\s*\(/.test(sw),
    "cache.addAll() is all-or-nothing: one 404 or redirect in SHELL_URLS fails the install " +
      "and leaves no service worker. Cache each URL independently."
  );
  assert.ok(
    /allSettled/.test(sw),
    "expected Promise.allSettled over individual cache.add() calls so partial failures are tolerated"
  );
});

// Without updateViaCache: "none" the browser may serve sw.js from the HTTP cache
// and never notice a new deploy's worker, which defeats the per-deploy cache name.
test("the service worker is registered with updateViaCache: none", () => {
  const src = read("lib/usePush.ts");
  assert.match(
    src,
    /updateViaCache:\s*"none"/,
    'register("/sw.js") must pass { updateViaCache: "none" } — per the Next.js PWA guide'
  );
});

// /sw.js must not sit behind middleware: see lib/publicAssets.ts. A 503 for the
// worker script is how a Redis outage took the offline fallback down with it.
test("the service worker path is excluded from middleware", async () => {
  const { isPublicAsset } = await import("../lib/publicAssets");
  assert.equal(isPublicAsset("/sw.js"), true);
});
