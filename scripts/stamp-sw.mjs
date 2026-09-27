#!/usr/bin/env node
// Stamp the service worker's cache name with the deployment SHA.
//
// public/sw.js is served as a static file, so nothing rewrites it at runtime.
// Its CACHE_NAME used to be a hand-bumped literal, and `activate` only deletes
// caches whose name differs from the current one — so a forgotten bump meant the
// previous deploy's cached shell HTML lived on, pointing at /_next/static/
// hashes that no longer existed. Blank page for returning and offline users.
//
// Two deliberate choices:
//
// 1. This rewrites the committed file in place rather than generating it from a
//    template into a gitignored path. If the generator were the only source of
//    public/sw.js, a pipeline that skipped this step would ship NO service
//    worker — no offline shell, no push. In-place stamping degrades to the old
//    static-name behaviour instead, which is merely suboptimal.
// 2. It no-ops unless VERCEL_GIT_COMMIT_SHA is present, so a local `npm run
//    build` does not leave the working tree dirty.
//
// Exits non-zero if the file exists but the expected line is missing, because
// silently not stamping is how this regressed in the first place.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const swPath = join(root, "public", "sw.js");

const sha = process.env.VERCEL_GIT_COMMIT_SHA;
if (!sha) {
  console.log("[stamp-sw] VERCEL_GIT_COMMIT_SHA unset — leaving public/sw.js alone (local build).");
  process.exit(0);
}

const LINE = /^const CACHE_NAME = "[^"]*";$/m;

let src;
try {
  src = readFileSync(swPath, "utf8");
} catch (e) {
  console.error(`[stamp-sw] cannot read ${swPath}: ${e.message}`);
  process.exit(1);
}

if (!LINE.test(src)) {
  console.error(
    '[stamp-sw] no `const CACHE_NAME = "...";` line in public/sw.js. ' +
      "Someone changed its shape; the cache name is no longer being stamped per deploy, " +
      "which reintroduces the stale-shell bug. Fix this script or the worker."
  );
  process.exit(1);
}

const name = `wmny-shell-${sha.slice(0, 7)}`;
writeFileSync(swPath, src.replace(LINE, `const CACHE_NAME = "${name}";`), "utf8");
console.log(`[stamp-sw] CACHE_NAME = ${name}`);
