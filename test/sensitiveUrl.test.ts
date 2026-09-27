import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSensitivePath,
  redactSensitivePath,
  redactSensitiveUrl,
  SENSITIVE_PATH_PREFIXES,
} from "../lib/sensitiveUrl";
import { scrubDeep, scrubEvent } from "../lib/sentryScrub";

// These guard a live account-takeover credential. /reset-password/<jwt> and
// /verify-email/<token> put the token in the URL path, and every telemetry
// client on the page records the URL, so a regression here writes reset JWTs
// back into Google Analytics, Vercel Analytics and Sentry.

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJhYmMiLCJleHAiOjk5OTk5OTk5OTl9.c2lnbmF0dXJl";

test("isSensitivePath matches the credential-bearing routes and nothing else", () => {
  assert.equal(isSensitivePath(`/reset-password/${JWT}`), true);
  assert.equal(isSensitivePath("/reset-password"), true);
  assert.equal(isSensitivePath("/verify-email/abc123"), true);
  assert.equal(isSensitivePath("/login"), false);
  assert.equal(isSensitivePath("/depot/QV/swaps"), false);
  // Must not match a route that merely starts with the same characters.
  assert.equal(isSensitivePath("/reset-password-help"), false);
  assert.equal(isSensitivePath("/verify-emails-faq"), false);
});

test("redactSensitivePath keeps the route but drops the credential", () => {
  assert.equal(redactSensitivePath(`/reset-password/${JWT}`), "/reset-password/[redacted]");
  assert.equal(redactSensitivePath("/verify-email/abc123"), "/verify-email/[redacted]");
  assert.equal(redactSensitivePath("/depot/QV/swaps"), "/depot/QV/swaps");
  // The redacted form must never still contain the token.
  assert.ok(!redactSensitivePath(`/reset-password/${JWT}`).includes(JWT));
});

test("redactSensitiveUrl handles absolute URLs, query strings and relative paths", () => {
  assert.equal(
    redactSensitiveUrl(`https://wmnyshiftswap.com/reset-password/${JWT}`),
    "https://wmnyshiftswap.com/reset-password/[redacted]",
  );
  // Query and fragment are dropped along with the path segment.
  assert.equal(
    redactSensitiveUrl(`https://wmnyshiftswap.com/reset-password/${JWT}?src=email#top`),
    "https://wmnyshiftswap.com/reset-password/[redacted]",
  );
  assert.equal(redactSensitiveUrl(`/reset-password/${JWT}`), "/reset-password/[redacted]");
  // Non-sensitive URLs pass through untouched.
  assert.equal(
    redactSensitiveUrl("https://wmnyshiftswap.com/depot/QV/swaps?filter=open"),
    "https://wmnyshiftswap.com/depot/QV/swaps?filter=open",
  );
  // Garbage must not throw.
  assert.equal(redactSensitiveUrl("not a url"), "not a url");
});

test("scrubDeep filters sensitive keys at every depth, not just the top level", () => {
  const input = {
    email: "operator@example.com",
    nested: { user: { email: "operator@example.com", firstName: "Ryan" } },
    list: [{ password: "hunter2" }, { contact: "+15551234567" }],
    keep: "visible",
  };
  const out = scrubDeep(input) as Record<string, unknown>;

  assert.equal(out.email, "[Filtered]");
  // The old top-level-only scrubber let this through — the regression this locks.
  const nested = (out.nested as Record<string, Record<string, unknown>>).user;
  assert.equal(nested.email, "[Filtered]");
  assert.equal(nested.firstName, "Ryan");
  const list = out.list as Array<Record<string, unknown>>;
  assert.equal(list[0].password, "[Filtered]");
  assert.equal(list[1].contact, "[Filtered]");
  assert.equal(out.keep, "visible");
  // No sensitive value survives anywhere in the serialized result.
  const json = JSON.stringify(out);
  assert.ok(!json.includes("operator@example.com"));
  assert.ok(!json.includes("hunter2"));
});

test("scrubDeep does not blow up on deep nesting or null", () => {
  assert.equal(scrubDeep(null), null);
  assert.equal(scrubDeep("plain"), "plain");
  // Deeper than MAX_DEPTH: must return rather than recurse forever.
  let deep: Record<string, unknown> = { password: "leaf" };
  for (let i = 0; i < 20; i++) deep = { level: deep };
  assert.doesNotThrow(() => scrubDeep(deep));
});

test("scrubEvent redacts the request URL and drops cookies and query strings", () => {
  const event = {
    request: {
      url: `https://wmnyshiftswap.com/reset-password/${JWT}`,
      query_string: "token=secret",
      cookies: { accessToken: "abc" },
      headers: { authorization: "Bearer abc", "user-agent": "Safari" },
      data: { nested: { password: "hunter2" } },
    },
    tags: { email: "operator@example.com", route: "reset" },
    message: `failed at https://wmnyshiftswap.com/reset-password/${JWT}`,
    exception: {
      values: [{ value: `Prisma error at /verify-email/tok123` }],
    },
  };

  const out = scrubEvent(event as unknown as Record<string, unknown>) as typeof event;

  assert.equal(out.request.url, "https://wmnyshiftswap.com/reset-password/[redacted]");
  assert.equal(out.request.query_string, undefined);
  assert.equal(out.request.cookies, undefined);
  assert.equal((out.request.headers as Record<string, unknown>).authorization, "[Filtered]");
  assert.equal((out.request.headers as Record<string, unknown>)["user-agent"], "Safari");
  assert.equal(
    ((out.request.data as Record<string, Record<string, unknown>>).nested).password,
    "[Filtered]",
  );
  assert.equal((out.tags as Record<string, unknown>).email, "[Filtered]");
  assert.equal((out.tags as Record<string, unknown>).route, "reset");
  assert.ok(!out.message.includes(JWT));
  assert.ok(!out.exception.values[0].value.includes("tok123"));

  // The whole event, serialized, must not contain the credential anywhere.
  assert.ok(!JSON.stringify(out).includes(JWT));
});

// Regression: GA4 sends BOTH page_path ('dp') and page_location ('dl'), and
// 'dl' is attached automatically to every hit from window.location.href —
// including enhanced-measurement events like scroll that the app never fires.
// Redacting only page_path shipped to production and leaked a live reset JWT
// to Google Analytics: observed dp=/reset-password/[redacted] alongside
// dl=https://www.wmnyshiftswap.com/reset-password/<the real token>.
//
// app/layout.tsx duplicates the prefix list in an inline script (it cannot
// import this module) to pin page_location before the first hit. If that list
// drifts from SENSITIVE_PATH_PREFIXES, the leak comes back silently.
test("the inline gtag script in layout.tsx covers every sensitive prefix", async () => {
  const { readFileSync } = await import("node:fs");
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

  // page_location must be set on the gtag config, not just page_path.
  assert.match(
    layout,
    /gtag\('config'[\s\S]*page_location/,
    "layout.tsx must pin page_location on the gtag config — page_path alone leaks 'dl'",
  );

  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    assert.ok(
      layout.includes(`'${prefix}'`),
      `layout.tsx inline SENSITIVE list is missing ${prefix} — it must stay in sync with lib/sensitiveUrl.ts`,
    );
  }
});

test("redactSensitiveUrl strips the credential from an absolute page_location", () => {
  assert.equal(
    redactSensitiveUrl(`https://www.wmnyshiftswap.com/reset-password/${JWT}`),
    "https://www.wmnyshiftswap.com/reset-password/[redacted]",
  );
  assert.equal(
    redactSensitiveUrl("https://www.wmnyshiftswap.com/board"),
    "https://www.wmnyshiftswap.com/board",
  );
});
