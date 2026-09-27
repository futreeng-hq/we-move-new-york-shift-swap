import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "../lib/rateLimit";

// Every distinct string clientIp returns becomes a distinct Redis bucket key, so
// anything that can influence it can mint unlimited fresh rate-limit counters
// and walk straight past the login / register / forgot-password limits.

function req(headers: Record<string, string>): Request {
  return new Request("https://wmnyshiftswap.com/api/auth/login", { headers });
}

test("clientIp prefers x-vercel-forwarded-for over a forged X-Forwarded-For", () => {
  // Vercel sets x-vercel-forwarded-for to the true client IP and a client
  // cannot forge it. X-Forwarded-For's leftmost entry is only trustworthy while
  // nothing else sits in front of the app, so preferring the Vercel header
  // keeps the limiter correct if Cloudflare or an ALB is ever added without
  // anyone remembering to set TRUSTED_PROXY_HOPS.
  assert.equal(
    clientIp(req({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "1.2.3.4, 203.0.113.7",
    })),
    "203.0.113.7",
  );
});

test("clientIp rejects the malformed IPv6 strings that used to mint fresh buckets", () => {
  // The old validator was `v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v)`, which
  // accepted all of these. An attacker walked "1:1", "1:2", "1:3"… for an
  // unlimited supply of counters.
  for (const junk of [":", "1:2", "a:b", "::::", "1:1", ":::", "f:f:f"]) {
    assert.equal(
      clientIp(req({ "x-vercel-forwarded-for": junk })),
      null,
      `expected ${JSON.stringify(junk)} to be rejected`,
    );
  }
});

test("clientIp still accepts the real address forms", () => {
  const cases: Array<[string, string]> = [
    ["203.0.113.7", "203.0.113.7"],
    ["255.255.255.255", "255.255.255.255"],
    ["::1", "::1"],
    ["2001:db8::1", "2001:db8::1"],
    ["2001:0db8:85a3:0000:0000:8a2e:0370:7334", "2001:0db8:85a3:0000:0000:8a2e:0370:7334"],
    ["::ffff:1.2.3.4", "::ffff:1.2.3.4"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(clientIp(req({ "x-vercel-forwarded-for": input })), expected);
  }
});

test("clientIp rejects out-of-range IPv4 and header junk", () => {
  for (const junk of ["256.1.1.1", "999.999.999.999", "garbage", "", "1.2.3", "<script>"]) {
    assert.equal(clientIp(req({ "x-vercel-forwarded-for": junk })), null);
  }
});

test("clientIp returns null rather than a shared bucket when nothing is trustworthy", () => {
  // Deliberate: collapsing un-attributable requests into one "unknown" bucket
  // let an attacker exhaust that counter for every such user at once. Callers
  // decide the policy for null explicitly.
  assert.equal(clientIp(req({})), null);
});

test("clientIp falls back to X-Forwarded-For then x-real-ip off Vercel", () => {
  assert.equal(clientIp(req({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" })), "198.51.100.9");
  assert.equal(clientIp(req({ "x-real-ip": "198.51.100.22" })), "198.51.100.22");
  // A junk XFF must not shadow a valid x-real-ip.
  assert.equal(clientIp(req({ "x-forwarded-for": "1:2", "x-real-ip": "198.51.100.33" })), "198.51.100.33");
});
