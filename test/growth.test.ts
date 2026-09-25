import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { escapeICS, icsDate, icsDatePlusOne, buildCalendar } from "../lib/ics";
import { canShowInstallPrompt, detectPlatform, COOLDOWN_MS } from "../lib/installPrompt";

const DB = !!process.env.DATABASE_URL;
process.env.JWT_SECRET ??= "growth-test-secret";
process.env.JWT_REFRESH_SECRET ??= "growth-test-refresh";
process.env.JWT_RESET_SECRET ??= "growth-test-reset";
process.env.CRON_SECRET ??= "growth-test-cron";
process.env.NEXT_PUBLIC_APP_URL ??= "https://test.wmnyshiftswap.com";

// ── ICS (pure) ──────────────────────────────────────────────────────────────

test("escapeICS escapes per RFC 5545", () => {
  assert.equal(escapeICS("a,b;c"), "a\\,b\\;c");
  assert.equal(escapeICS("line1\nline2"), "line1\\nline2");
  assert.equal(escapeICS("back\\slash"), "back\\\\slash");
});

test("icsDate / icsDatePlusOne produce all-day VALUE=DATE strings", () => {
  const d = new Date("2026-08-15T00:00:00Z");
  assert.equal(icsDate(d), "20260815");
  assert.equal(icsDatePlusOne(d), "20260816");
  // month/year rollover
  assert.equal(icsDatePlusOne(new Date("2026-12-31T00:00:00Z")), "20270101");
});

test("buildCalendar emits one VEVENT per event with CRLF and unique UIDs", () => {
  const stamp = new Date("2026-07-01T00:00:00Z");
  const cal = buildCalendar([
    { uid: "a-from@x", date: new Date("2026-08-15T00:00:00Z"), summary: "S1", description: "D1", url: "u", stamp },
    { uid: "a-to@x", date: new Date("2026-08-20T00:00:00Z"), summary: "S2", description: "D2", url: "u", stamp },
  ]);
  assert.equal((cal.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(cal.includes("UID:a-from@x"));
  assert.ok(cal.includes("UID:a-to@x"));
  assert.ok(cal.includes("DTSTART;VALUE=DATE:20260815"));
  assert.ok(cal.includes("\r\n"), "CRLF line endings");
  assert.ok(cal.startsWith("BEGIN:VCALENDAR"));
  assert.ok(cal.trimEnd().endsWith("END:VCALENDAR"));
});

// ── Install prompt logic (pure) ─────────────────────────────────────────────

test("detectPlatform classifies standalone / iOS / other", () => {
  assert.equal(detectPlatform("iPhone", true), "installed");
  assert.equal(detectPlatform("Mozilla/5.0 (iPhone)", false), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android)", false), "other");
});

test("canShowInstallPrompt honors sessions, lifetime cap, and cooldown", () => {
  const now = 1_000_000_000_000;
  assert.equal(canShowInstallPrompt({ dismissedAt: null, showCount: 0, sessionCount: 1 }, now), false, "1st session");
  assert.equal(canShowInstallPrompt({ dismissedAt: null, showCount: 0, sessionCount: 2 }, now), true, "2nd session ok");
  assert.equal(canShowInstallPrompt({ dismissedAt: null, showCount: 3, sessionCount: 5 }, now), false, "lifetime cap");
  assert.equal(canShowInstallPrompt({ dismissedAt: now - 1000, showCount: 0, sessionCount: 5 }, now), false, "in cooldown");
  assert.equal(canShowInstallPrompt({ dismissedAt: now - COOLDOWN_MS - 1, showCount: 0, sessionCount: 5 }, now), true, "past cooldown");
});

// ── DB-gated ────────────────────────────────────────────────────────────────

async function ctx() {
  const { prisma } = await import("../lib/prisma");
  const { getPublicSwap } = await import("../lib/publicSwap");
  const { signAccessToken } = await import("../lib/auth");
  const { NextRequest } = await import("next/server");
  return { prisma, getPublicSwap, signAccessToken, NextRequest };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

async function seed(c: Ctx, tag: string) {
  const depot = await c.prisma.depot.create({ data: { name: `Flatbush ${tag}`, code: tag, borough: "Brooklyn", operator: "NYCT" } });
  const mk = (n: string) => c.prisma.user.create({ data: { email: `${tag}-${n}@test.invalid`, passwordHash: "x", firstName: n, lastName: "Tester", depotId: depot.id }, select: { id: true, email: true } });
  return { depot, mk };
}
async function cleanup(c: Ctx, tag: string, depotId: string) {
  const users = await c.prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await c.prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await c.prisma.swapAgreement.deleteMany({ where: { swap: { depotId } } });
  await c.prisma.inviteCode.deleteMany({ where: { OR: [{ createdBy: { in: ids } }, { usedBy: { in: ids } }] } });
  await c.prisma.reputation.deleteMany({ where: { userId: { in: ids } } });
  await c.prisma.swap.deleteMany({ where: { depotId } });
  await c.prisma.user.deleteMany({ where: { id: { in: ids } } });
  await c.prisma.depot.deleteMany({ where: { id: depotId } });
}

test("teaser field discipline: projection never leaks details or contact", { skip: !DB }, async () => {
  const c = await ctx();
  const tag = `gr${randomUUID().slice(0, 6)}`;
  const { depot, mk } = await seed(c, tag);
  try {
    const owner = await mk("owner");
    const swap = await c.prisma.swap.create({
      data: {
        userId: owner.id, depotId: depot.id, category: "work", status: "open",
        posterName: "Owner Tester",
        details: "SECRET_DETAILS_555_1234", contact: "secret@contact.example",
        date: new Date("2026-08-15T00:00:00Z"), startTime: "06:00", clearTime: "14:00",
      },
    });
    const pub = await c.getPublicSwap(swap.id);
    assert.ok(pub);
    const json = JSON.stringify(pub);
    assert.ok(!json.includes("SECRET_DETAILS_555_1234"), "details never exposed");
    assert.ok(!json.includes("secret@contact.example"), "contact never exposed");
    assert.ok(!json.includes("Tester"), "last name never exposed");
    assert.equal(pub!.posterMasked, "Owner T.");
    assert.equal(pub!.status, "open");
    assert.equal(pub!.startTime, "06:00"); // structured fields are fine
  } finally { await cleanup(c, tag, depot.id); }
});

test("teaser states: unavailable + open count, nonexistent, malformed", { skip: !DB }, async () => {
  const c = await ctx();
  const tag = `gr${randomUUID().slice(0, 6)}`;
  const { depot, mk } = await seed(c, tag);
  try {
    const owner = await mk("owner");
    await c.prisma.swap.create({ data: { userId: owner.id, depotId: depot.id, category: "work", status: "open", posterName: "O T", details: "x" } });
    const filled = await c.prisma.swap.create({ data: { userId: owner.id, depotId: depot.id, category: "work", status: "filled", posterName: "O T", details: "y" } });

    const pub = await c.getPublicSwap(filled.id);
    assert.equal(pub!.status, "unavailable");
    assert.equal(pub!.openCountAtDepot, 1, "one open swap at the depot");

    assert.equal(await c.getPublicSwap(randomUUID()), null, "nonexistent id → null");
    assert.equal(await c.getPublicSwap("not-a-uuid!!"), null, "malformed id → null");
  } finally { await cleanup(c, tag, depot.id); }
});

test("ICS route: participant-only, two-VEVENT daysoff, all-day DTSTART, undated 404", { skip: !DB }, async () => {
  const c = await ctx();
  const { GET } = await import("../app/api/swaps/[id]/agreement/calendar/route");
  const tag = `gr${randomUUID().slice(0, 6)}`;
  const { depot, mk } = await seed(c, tag);
  const call = (swapId: string, userId: string, email: string) =>
    GET(new c.NextRequest("http://localhost/cal", { headers: { authorization: `Bearer ${c.signAccessToken({ userId, email })}` } }),
        { params: Promise.resolve({ id: swapId }) });
  try {
    const owner = await mk("owner");
    const taker = await mk("taker");
    const stranger = await mk("stranger");

    // daysoff swap with two dates + accepted agreement
    const swap = await c.prisma.swap.create({
      data: { userId: owner.id, depotId: depot.id, category: "daysoff", status: "pending", posterName: "Owner T", details: "d",
        fromDate: new Date("2026-08-15T00:00:00Z"), toDate: new Date("2026-08-20T00:00:00Z") },
    });
    await c.prisma.swapAgreement.create({
      data: { swapId: swap.id, userAId: taker.id, userBId: owner.id, status: "accepted", acceptedAt: new Date(), shiftDate: new Date("2026-08-20T00:00:00Z") },
    });

    const res = await call(swap.id, taker.id, taker.email);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/calendar/);
    const body = await res.text();
    assert.equal((body.match(/BEGIN:VEVENT/g) || []).length, 2, "two VEVENTs for a daysoff swap");
    assert.ok(body.includes("DTSTART;VALUE=DATE:20260815"));
    assert.ok(body.includes("DTSTART;VALUE=DATE:20260820"));
    assert.ok(body.includes("owner T."), "other party's masked name in SUMMARY");

    // Non-participant → 404
    const strangerRes = await call(swap.id, stranger.id, stranger.email);
    assert.equal(strangerRes.status, 404);

    // Undated vacation → 404 (nothing to export)
    const vac = await c.prisma.swap.create({ data: { userId: owner.id, depotId: depot.id, category: "vacation", status: "pending", posterName: "O T", details: "v" } });
    await c.prisma.swapAgreement.create({ data: { swapId: vac.id, userAId: taker.id, userBId: owner.id, status: "accepted", acceptedAt: new Date() } });
    const vacRes = await call(vac.id, taker.id, taker.email);
    assert.equal(vacRes.status, 404);
  } finally { await cleanup(c, tag, depot.id); }
});

test("attribution: wmny_src cookie stamps signupSource on register (allowlisted)", { skip: !DB }, async () => {
  const c = await ctx();
  const { POST } = await import("../app/api/auth/register/route");
  const tag = `gr${randomUUID().slice(0, 6)}`;
  const { depot, mk } = await seed(c, tag);
  // Register is rate-limited to 5/hour PER IP, and the limiter's Redis state
  // outlives a single `npm test`. With a hardcoded IP this test passed on a
  // fresh Redis and then failed with an opaque 429 on the second run against
  // the same one — including a CI job retry. A unique source IP per run keeps
  // the bucket to this test's own 3 registrations.
  const srcIp = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
  const register = async (emailLocal: string, cookie?: string) => {
    const code = `INV${randomUUID().slice(0, 6).toUpperCase()}`;
    const inviter = await mk(`inv-${emailLocal}`);
    await c.prisma.inviteCode.create({ data: { code, createdBy: inviter.id, isValid: true } });
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": srcIp };
    if (cookie) headers.cookie = cookie;
    const res = await POST(new c.NextRequest("http://localhost/api/auth/register", {
      method: "POST", headers,
      body: JSON.stringify({ firstName: "New", lastName: "User", email: `${tag}-${emailLocal}@test.invalid`, password: "abcd1234efgh", inviteCode: code }),
    }));
    return res;
  };
  try {
    const withSrc = await register("shared", "wmny_src=share");
    assert.equal(withSrc.status, 201, await withSrc.text().catch(() => ""));
    const u1 = await c.prisma.user.findUniqueOrThrow({ where: { email: `${tag}-shared@test.invalid` } });
    assert.equal(u1.signupSource, "share");

    const noSrc = await register("organic");
    assert.equal(noSrc.status, 201);
    const u2 = await c.prisma.user.findUniqueOrThrow({ where: { email: `${tag}-organic@test.invalid` } });
    assert.equal(u2.signupSource, null);

    const bogus = await register("bogus", "wmny_src=evil-injection");
    assert.equal(bogus.status, 201);
    const u3 = await c.prisma.user.findUniqueOrThrow({ where: { email: `${tag}-bogus@test.invalid` } });
    assert.equal(u3.signupSource, null, "unknown source is dropped");
  } finally { await cleanup(c, tag, depot.id); }
});
