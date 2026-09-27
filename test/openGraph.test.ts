import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Found in the 2026-09-27 pre-launch audit: the root page served no Open Graph
// tags at all. app/s/[id]/opengraph-image.tsx produced a card for individual
// swap links, but the URL an operator actually texts a coworker —
// wmnyshiftswap.com — unfurled as a bare link with no preview. For an
// invite-only app that spreads by word of mouth inside a depot, that link is
// the growth channel.

test("the root layout declares Open Graph metadata", () => {
  const src = read("app/layout.tsx");
  assert.match(src, /openGraph:\s*\{/, "app/layout.tsx must export openGraph metadata");
  assert.match(src, /siteName:/, "openGraph needs a siteName");
  assert.match(src, /description:/, "openGraph needs a description");
});

// Without metadataBase, Next cannot turn the relative opengraph-image route
// into the absolute URL scrapers require, and the card silently does not
// render — indistinguishable from having no card.
test("metadataBase is set so the image resolves to an absolute URL", () => {
  const src = read("app/layout.tsx");
  assert.match(
    src,
    /metadataBase:\s*new URL\(/,
    "metadataBase is required for the opengraph-image route to resolve absolutely"
  );
  assert.match(src, /www\.wmnyshiftswap\.com/, "metadataBase must be the canonical www host");
});

test("a root opengraph-image route exists", () => {
  assert.ok(
    existsSync(new URL("../app/opengraph-image.tsx", import.meta.url)),
    "app/opengraph-image.tsx must exist — it is what Next turns into og:image for the root"
  );
  const src = read("app/opengraph-image.tsx");
  assert.match(src, /size\s*=\s*\{\s*width:\s*1200,\s*height:\s*630\s*\}/, "1200x630 is the expected card size");
  assert.match(src, /export const alt/, "an alt string is required for accessibility");
});

// The card is forwarded to people without accounts. It must not carry swap
// details, depot rosters or names — the per-swap card is the place for that,
// behind a link that already scopes what it reveals.
test("the root card is static and leaks nothing user-specific", () => {
  const src = read("app/opengraph-image.tsx");
  assert.ok(!/prisma|getPublicSwap|await\s+fetch/.test(src), "the root card must not read user or swap data");
  assert.ok(!/params/.test(src), "the root card takes no params — it is the same for everyone");
});

// Verified on a real installed iPhone on 2026-09-27: nothing is clipped,
// because Next's default viewport omits viewport-fit=cover and iOS therefore
// keeps the web view inside the safe area. Adding viewport-fit=cover without
// env(safe-area-inset-*) padding would switch on full-bleed and put the header
// under the notch. This guards that pairing.
test("viewport-fit=cover is not enabled without safe-area handling", () => {
  const layout = read("app/layout.tsx");
  const css = read("app/globals.css");

  const coverEnabled = /viewportFit:\s*["']cover["']|viewport-fit=cover/.test(layout);
  const hasInsets = /env\(\s*safe-area-inset/.test(css) || /env\(\s*safe-area-inset/.test(layout);

  assert.ok(
    !coverEnabled || hasInsets,
    "viewport-fit=cover is enabled but no env(safe-area-inset-*) padding exists — " +
      "this puts the header under the notch and fixed elements under the home indicator on iOS"
  );
});
