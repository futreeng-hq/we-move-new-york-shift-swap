import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluatePushSupport, detectIOS, type PushEnv } from "../lib/pushSupport";

function env(over: Partial<PushEnv> = {}): PushEnv {
  return {
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    permission: "default",
    isIOS: false,
    isStandalone: false,
    ...over,
  };
}

// ─── The iOS regression this module exists for ───────────────────────────────

// iOS Safari 16.4+ puts PushManager on the window even in an ordinary tab, but
// exposes Notification ONLY inside an installed home-screen app. The old
// components checked serviceWorker + PushManager, concluded push was available,
// and then read Notification.permission — a TypeError, thrown synchronously in
// a mount effect where no .catch() could see it.
test("iOS in a browser tab reports needs-install, not unsupported", () => {
  const state = evaluatePushSupport(
    env({ isIOS: true, isStandalone: false, hasNotification: false, permission: undefined })
  );
  assert.equal(state, "needs-install");
});

// Ordering guard. If the hasNotification check were hoisted above the iOS
// check, this same input would return "unsupported" and the UI would hide the
// one action that fixes it — which is how iOS push looked impossible.
test("needs-install wins over the missing Notification API on iOS", () => {
  const state = evaluatePushSupport(
    env({ isIOS: true, isStandalone: false, hasNotification: false })
  );
  assert.notEqual(state, "unsupported");
  assert.equal(state, "needs-install");
});

test("iOS installed to the home screen is supported", () => {
  assert.equal(
    evaluatePushSupport(env({ isIOS: true, isStandalone: true, permission: "default" })),
    "supported"
  );
  assert.equal(
    evaluatePushSupport(env({ isIOS: true, isStandalone: true, permission: "granted" })),
    "supported"
  );
});

test("iOS installed with permission denied is blocked", () => {
  assert.equal(
    evaluatePushSupport(env({ isIOS: true, isStandalone: true, permission: "denied" })),
    "blocked"
  );
});

// ─── The other branches ──────────────────────────────────────────────────────

test("a normal browser with permission still to ask is supported", () => {
  assert.equal(evaluatePushSupport(env()), "supported");
});

test("denied is blocked", () => {
  assert.equal(evaluatePushSupport(env({ permission: "denied" })), "blocked");
});

test("no service worker or no push manager is unsupported", () => {
  assert.equal(evaluatePushSupport(env({ hasServiceWorker: false })), "unsupported");
  assert.equal(evaluatePushSupport(env({ hasPushManager: false })), "unsupported");
});

test("a non-iOS browser without the Notification API is unsupported", () => {
  assert.equal(evaluatePushSupport(env({ hasNotification: false })), "unsupported");
});

// ─── iPadOS 13+ masquerades as a Mac ─────────────────────────────────────────

test("detectIOS catches iPadOS reporting a Mac user agent", () => {
  const iPadOS =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  assert.equal(detectIOS(iPadOS, 5), true, "touch points give it away");
  assert.equal(detectIOS(iPadOS, 0), false, "a real Mac has no touch points");
});

test("detectIOS matches the obvious iPhone and iPad user agents", () => {
  assert.equal(detectIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5), true);
  assert.equal(detectIOS("Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X)", 5), true);
  assert.equal(detectIOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0), false);
});

// ─── Source guard ────────────────────────────────────────────────────────────
//
// Same tactic as test/sensitiveUrl.test.ts: the bug was a bare property read in
// a component, so assert no component performs one again. Every read has to go
// through readPushEnv(), which checks `"Notification" in window` first.

for (const file of ["components/ui/NotifToggle.tsx", "components/ui/PushBanner.tsx", "lib/usePush.ts"]) {
  test(`${file} does not touch the Notification API directly`, () => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(
      !/\bNotification\.\w/.test(src),
      `${file} reads the Notification API directly. On iOS Safari in a browser tab ` +
        `window.Notification is undefined and this throws. Go through readPushEnv() ` +
        `in lib/pushSupport.ts, which guards with \`"Notification" in window\`.`
    );
  });
}

test("readPushEnv guards the Notification read", () => {
  const src = readFileSync(new URL("../lib/pushSupport.ts", import.meta.url), "utf8");
  assert.ok(
    /"Notification" in window/.test(src),
    "lib/pushSupport.ts must feature-detect Notification before reading .permission"
  );
  assert.ok(
    /hasNotification \?\s*Notification\.permission\s*:\s*undefined/.test(src),
    "the .permission read must be gated on hasNotification"
  );
});
