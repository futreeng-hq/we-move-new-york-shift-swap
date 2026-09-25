/**
 * Browser smoke test for WMNY Shift Swap.
 *
 * Covers what the unit suite structurally cannot: whether the pages actually
 * render, and whether the security boundaries hold through a real HTTP session
 * with real cookies. Every check here was written against a bug that was live
 * in production and passing 86 unit tests.
 *
 * Usage:
 *   npm i -D playwright            # once; the browser binary comes with it
 *   npm run build && npm start     # or point BASE_URL at any running instance
 *   node qa-smoke.mjs
 *
 * Environment:
 *   BASE_URL         defaults to http://localhost:3000
 *   DATABASE_URL     required — the harness seeds and removes its own fixtures
 *
 * Self-contained by design. Each run creates its own depots, operators and
 * swaps under a unique tag, drives them, then deletes everything it made. It
 * never touches rows it did not create, so it is safe to point at a staging
 * database and safe to run back to back — earlier runs cannot contaminate
 * later ones, which is the failure mode that makes most smoke suites rot.
 *
 * Exits non-zero if any check fails, so CI can gate on it.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PW = "QaSmokePassword123";
const TAG = randomUUID().slice(0, 8);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — the harness seeds its own fixtures.");
  process.exit(2);
}

// Imported dynamically so a missing dependency gives an instruction rather than
// a module-resolution stack trace. Playwright is deliberately NOT in
// package.json: it would pull a browser download into every `npm ci`, including
// the build and unit-test jobs that have no use for it.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("playwright is not installed. Run:\n\n  npm i -D playwright\n");
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

const results = [];
const consoleErrors = [];

function check(id, name, passed, detail = "") {
  results.push({ id, name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${id.padEnd(9)} ${name}${detail ? "\n          " + detail : ""}`);
}

/**
 * Rate limits are keyed by client IP (login, register) and by user+swap
 * (agreement proposals). Giving every logical actor its own source IP, and
 * every run its own users, is what keeps a second run from tripping limits the
 * first one consumed. Vercel sets x-vercel-forwarded-for itself in production
 * and ignores any inbound value, so this is a test-only lever.
 */
let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;

function attach(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[${label}] ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[${label}] PAGEERROR ${String(e).slice(0, 200)}`));
}

async function api(page, path, init = {}, ip = null) {
  return page.evaluate(async ([p, i, xip]) => {
    const res = await fetch(p, {
      ...i,
      headers: { "content-type": "application/json", ...(xip ? { "x-vercel-forwarded-for": xip } : {}), ...(i.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* not json */ }
    return { status: res.status, body };
  }, [path, init, ip]);
}

async function signIn(page, email, ip) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  return api(page, "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: PW }) }, ip);
}

// --------------------------------------------------------------- fixtures
async function seed() {
  const hash = await bcrypt.hash(PW, 10);
  const mkDepot = (suffix, name, borough) =>
    prisma.depot.create({ data: { name: `${name} (smoke ${TAG})`, code: `Z${TAG.slice(0, 3).toUpperCase()}${suffix}`, borough, operator: "NYCT" } });

  const home = await mkDepot("A", "Smoke Home Depot", "Manhattan");
  const other = await mkDepot("B", "Smoke Other Depot", "Brooklyn");

  const mkUser = (local, first, last, depotId, extra = {}) =>
    prisma.user.create({ data: {
      email: `${TAG}-${local}@qa.invalid`, passwordHash: hash, firstName: first, lastName: last,
      depotId, role: "operator", verified: true, termsAcceptedAt: new Date(), termsVersion: "1", ...extra,
    }});

  const owner = await mkUser("owner", "Ada", "Okonkwo", home.id);
  const peer = await mkUser("peer", "Ben", "Castillo", home.id);
  const proposer = await mkUser("proposer", "Cy", "Duarte", home.id);
  const outsider = await mkUser("outsider", "Dee", "Ferrari", other.id);
  const unverified = await mkUser("unverified", "Eve", "Grant", home.id, { verified: false });

  const inviter = owner;
  await prisma.inviteCode.create({ data: { code: `SMOKE${TAG.slice(0, 5).toUpperCase()}`, createdBy: inviter.id, isValid: true } });

  const soon = new Date(Date.now() + 20 * 60 * 60 * 1000); // inside the 48h URGENT window
  const homeSwap = await prisma.swap.create({ data: {
    userId: owner.id, depotId: home.id, posterName: "Ada Okonkwo", category: "work",
    details: `Smoke ${TAG}: B46 AM run, 5:14 pickup. Need coverage.`,
    contact: "555-0142", date: soon, status: "open",
  }});
  // A days-off swap exercises the from/to date rendering path, where the
  // "Invalid Date" bug lived.
  const daysOffSwap = await prisma.swap.create({ data: {
    userId: owner.id, depotId: home.id, posterName: "Ada Okonkwo", category: "daysoff",
    details: `Smoke ${TAG}: swapping Saturday for Tuesday.`,
    fromDay: "Saturday", toDay: "Tuesday",
    fromDate: new Date(Date.now() + 3 * 86400000), toDate: new Date(Date.now() + 6 * 86400000), status: "open",
  }});
  const outsideSwap = await prisma.swap.create({ data: {
    userId: outsider.id, depotId: other.id, posterName: "Dee Ferrari", category: "work",
    details: `Smoke ${TAG}: B12 PM run, other depot.`,
    contact: "555-0199", date: soon, status: "open",
  }});

  return { home, other, owner, peer, proposer, outsider, unverified, homeSwap, daysOffSwap, outsideSwap };
}

async function cleanup(fx) {
  if (!fx) return;
  const userIds = [fx.owner, fx.peer, fx.proposer, fx.outsider, fx.unverified].map((u) => u.id);
  const swapIds = [fx.homeSwap, fx.daysOffSwap, fx.outsideSwap].map((s) => s.id);
  // Children first; nothing here cascades reliably in both directions.
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.message.deleteMany({ where: { OR: [{ fromUserId: { in: userIds } }, { toUserId: { in: userIds } }] } }).catch(() => {});
  await prisma.swapAgreement.deleteMany({ where: { swapId: { in: swapIds } } }).catch(() => {});
  await prisma.savedSwap.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.report.deleteMany({ where: { swapId: { in: swapIds } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { adminId: { in: userIds } } }).catch(() => {});
  await prisma.inviteCode.deleteMany({ where: { createdBy: { in: userIds } } }).catch(() => {});
  await prisma.swap.deleteMany({ where: { id: { in: swapIds } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await prisma.depot.deleteMany({ where: { id: { in: [fx.home.id, fx.other.id] } } }).catch(() => {});
}

// -------------------------------------------------------------------- run
let fx = null;
let browser = null;

try {
  fx = await seed();
  console.log(`seeded fixtures under tag ${TAG}\n`);
  browser = await chromium.launch();

  // ------------------------------------------------------------ login page
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    attach(page, "login");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    // The intro splash plays on a first visit; wait it out rather than
    // pre-seeding sessionStorage, which would itself change what renders.
    await page.waitForFunction(() => /Sign In/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});

    const body = await page.textContent("body");
    check("UI-1", "Login page renders", (body || "").includes("Sign In"));

    const canonical = "We Move NY is not affiliated with, endorsed by, or operated by TWU Local 100 or the MTA.";
    check("DISC-1", "Canonical non-affiliation sentence present", (body || "").includes(canonical));

    const disc = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("p")).find((p) => p.textContent.includes("not affiliated with"));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { fontSize: parseFloat(cs.fontSize), color: cs.color };
    });
    check("DISC-2", "Disclosure is readable, not fine print", !!disc && disc.fontSize >= 13,
      disc ? `fontSize=${disc.fontSize}px color=${disc.color}` : "paragraph not found");

    await page.click('button:has-text("Register")');
    await page.waitForSelector("#reg-ack", { timeout: 10000 });
    check("REG-1", "Acknowledgement checkbox present on register form", true);

    for (const [id, val] of Object.entries({
      "reg-fn": "Smoke", "reg-ln": "Tester", "reg-email": `${TAG}-new@qa.invalid`,
      "reg-pw": "Str0ngPassword1", "reg-pw2": "Str0ngPassword1", "reg-invite": `SMOKE${TAG.slice(0, 5).toUpperCase()}`,
    })) {
      const el = await page.$(`#${id}`);
      if (el) await el.fill(val);
    }
    await page.click('button:has-text("Create Account")');
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => document.body.innerText);
    check("REG-2", "Register refuses to submit with the acknowledgement unchecked",
      /confirm you understand/i.test(after) && !/Check your email/i.test(after),
      `ackError=${/confirm you understand/i.test(after)} accountCreated=${/Check your email/i.test(after)}`);
    await ctx.close();
  }

  // ----------------------------------------------------- hydration cleanliness
  for (const [label, url, setup] of [
    ["first visit", `${BASE}/login`, null],
    ["returning visitor", `${BASE}/login`, (p) => p.addInitScript(() => { try { sessionStorage.setItem("intro-seen", "1"); } catch { /* blocked */ } })],
    ["invite link", `${BASE}/login?invite=SMOKE${TAG.slice(0, 5).toUpperCase()}`, (p) => p.addInitScript(() => { try { sessionStorage.setItem("intro-seen", "1"); } catch { /* blocked */ } })],
  ]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 90)));
    if (setup) await setup(page);
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    check(`HYD-${label.split(" ")[0]}`, `No hydration error — ${label}`, errs.length === 0, errs.join(" | "));
    await ctx.close();
  }

  // -------------------------------------------------------- enumeration
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attach(page, "enum");
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

    const reg = await api(page, "/api/auth/register", { method: "POST", body: JSON.stringify({
      firstName: "Dup", lastName: "Test", email: `${TAG}-owner@qa.invalid`,
      password: "Str0ngPassword1", inviteCode: "TOTALLYBOGUS",
    })}, nextIp());
    const msg = (reg.body && reg.body.error) || "";
    check("ENUM-1", "Bad invite code rejected before revealing the email exists",
      /invite/i.test(msg) && !/already registered/i.test(msg), `status=${reg.status} "${msg}"`);

    const cases = {
      unknown: { email: `${TAG}-nobody@qa.invalid`, password: "WrongPassword123" },
      wrongpw: { email: `${TAG}-peer@qa.invalid`, password: "WrongPassword123" },
      unverified: { email: `${TAG}-unverified@qa.invalid`, password: "WrongPassword123" },
    };
    const samples = { unknown: [], wrongpw: [], unverified: [] };
    const seen = { status: new Set(), error: new Set() };
    for (let round = 0; round < 7; round++) {
      for (const [k, creds] of Object.entries(cases)) {
        const t0 = Date.now();
        const r = await api(page, "/api/auth/login", { method: "POST", body: JSON.stringify(creds) }, nextIp());
        if (r.status === 401) samples[k].push(Date.now() - t0);
        seen.status.add(r.status);
        seen.error.add((r.body && r.body.error) || "");
      }
    }
    check("ENUM-2", "Unknown email, wrong password and unverified return one status",
      seen.status.size === 1, `statuses=${[...seen.status].join(",")}`);
    check("ENUM-3", "…and one message", seen.error.size === 1, [...seen.error].map((m) => `"${m}"`).join(" | "));

    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null; };
    const meds = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, med(v)]));
    const vals = Object.values(meds).filter((v) => v !== null);
    const spread = vals.length === 3 ? Math.max(...vals) - Math.min(...vals) : null;
    check("ENUM-4", "…in comparable time (no fast path for an unknown address)",
      spread !== null && spread < 60, `medians(ms)=${JSON.stringify(meds)} spread=${spread}`);

    const hint = await api(page, "/api/auth/login", { method: "POST", body: JSON.stringify({
      email: `${TAG}-unverified@qa.invalid`, password: PW,
    })}, nextIp());
    check("ENUM-5", "Unverified hint appears only once the password is proven",
      hint.status === 403 && /verify your email/i.test((hint.body && hint.body.error) || ""),
      `status=${hint.status} "${(hint.body && hint.body.error) || ""}"`);
    await ctx.close();
  }

  // ------------------------------------------------------------- the board
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    attach(page, "board");
    const r = await signIn(page, `${TAG}-owner@qa.invalid`, nextIp());
    check("AUTH-1", "Seeded operator can sign in", r.status === 200, `status=${r.status}`);

    await page.goto(`${BASE}/depot/${fx.home.code}/swaps`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction((t) => document.body.innerText.includes(t), `Smoke ${TAG}`, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const boardText = await page.evaluate(() => document.body.innerText);

    check("UI-2", "Depot board renders the seeded swaps", boardText.includes(`Smoke ${TAG}`));
    check("DATE-1", 'No literal "Invalid Date" rendered to the operator', !/Invalid Date/i.test(boardText));
    check("UI-3", "Time-based URGENT badge renders after mount", /URGENT/i.test(boardText),
      /URGENT/i.test(boardText) ? "" : "swap is inside the 48h window but no badge — check the post-mount clock read");

    const tiles = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => b.innerText.trim().split("\n"))
        .filter((t) => t.length >= 2 && /^Swap /.test(t[0]) && /^\d+$/.test(t[t.length - 1]))
        .map((t) => [t[0], Number(t[t.length - 1])]));
    const total = tiles.reduce((a, [, n]) => a + n, 0);
    check("COUNT-1", "Category tiles show real counts, not a stuck zero", total > 0, `tiles=${JSON.stringify(tiles)}`);

    for (const [path, id] of [["/profile", "UI-4"], ["/inbox", "UI-5"]]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      const t = await page.evaluate(() => document.body.innerText);
      check(id, `${path} renders`, t.length > 80 && !/Something went wrong/i.test(t),
        /Something went wrong/i.test(t) ? "error boundary caught a crash" : "");
    }
    await ctx.close();
  }

  // -------------------------------------------------- cross-depot boundaries
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attach(page, "depot");
    await signIn(page, `${TAG}-owner@qa.invalid`, nextIp());
    const id = fx.outsideSwap.id;

    const probes = [
      ["DEPOT-1", "GET", `/api/swaps/${id}`, {}],
      ["DEPOT-2", "SAVE", `/api/swaps/${id}/save`, { method: "POST", body: "{}" }],
      ["DEPOT-3", "INTEREST", `/api/swaps/${id}/interest`, { method: "POST", body: JSON.stringify({ text: "probe" }) }],
      ["DEPOT-4", "MESSAGE", `/api/messages`, { method: "POST", body: JSON.stringify({ swapId: id, text: "probe" }) }],
      ["DEPOT-5", "AGREEMENT", `/api/swaps/${id}/agreement`, { method: "POST", body: JSON.stringify({ note: "probe" }) }],
      ["DEPOT-6", "REPORT", `/api/swaps/${id}/report`, { method: "POST", body: JSON.stringify({ reason: "probe" }) }],
      ["DEPOT-8", "FLEXIBLE ROSTER", `/api/depots/${fx.other.code}/flexible`, {}],
      ["DEPOT-9", "ANNOUNCEMENTS", `/api/depots/${fx.other.code}/announcements`, {}],
    ];
    for (const [cid, label, path, init] of probes) {
      const res = await api(page, path, init, nextIp());
      check(cid, `${label} on another depot is refused`, res.status >= 400, `status=${res.status}`);
    }

    const saved = await api(page, "/api/swaps/saved", {}, nextIp());
    check("DEPOT-7", "Saved list never exposes the other depot's contact number",
      !JSON.stringify(saved.body || []).includes("555-0199"));
    await ctx.close();
  }

  // ------------------------------------------------------------- revocation
  {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    attach(a, "revokeA"); attach(b, "revokeB");
    const email = `${TAG}-peer@qa.invalid`;
    await signIn(a, email, nextIp());
    await signIn(b, email, nextIp());

    const before = await api(b, "/api/users/me");
    check("REVOKE-1", "Second device is authenticated to begin with", before.status === 200, `status=${before.status}`);
    const lo = await api(a, "/api/auth/logout-all", { method: "POST", body: "{}" });
    check("REVOKE-2", "logout-all succeeds on the first device", lo.status === 200, `status=${lo.status}`);
    const after = await api(b, "/api/users/me");
    check("REVOKE-3", "Second device refused on its very next request", after.status === 401,
      `status=${after.status} ${JSON.stringify(after.body)}`);
    await ctxA.close(); await ctxB.close();
  }

  // ------------------------------------- duplicate proposal / partial index
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attach(page, "dup");
    // A proposer used for nothing else, so the 3/hour per-user-per-swap
    // agreement limit cannot have been consumed by an earlier check.
    await signIn(page, `${TAG}-proposer@qa.invalid`, nextIp());
    const first = await api(page, `/api/swaps/${fx.homeSwap.id}/agreement`, { method: "POST", body: JSON.stringify({ note: "first" }) });
    const second = await api(page, `/api/swaps/${fx.homeSwap.id}/agreement`, { method: "POST", body: JSON.stringify({ note: "second" }) });
    check("IDX-1", "First proposal accepted", first.status === 201, `status=${first.status}`);
    check("IDX-2", "Duplicate proposal returns 409 from the partial unique index",
      second.status === 409, `status=${second.status} ${JSON.stringify(second.body)}`);
    await ctx.close();
  }

  // ------------------------------------ notification body carries no message
  {
    const secret = `SECRET-${TAG}-9271`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attach(page, "notifA");
    await signIn(page, `${TAG}-peer@qa.invalid`, nextIp());
    await api(page, "/api/messages", { method: "POST", body: JSON.stringify({ swapId: fx.homeSwap.id, text: `hello ${secret}` }) });
    await ctx.close();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    attach(page2, "notifB");
    await signIn(page2, `${TAG}-owner@qa.invalid`, nextIp());
    const notifs = await api(page2, "/api/notifications");
    const blob = JSON.stringify(notifs.body || {});
    check("PRIV-1", "Notification payload contains no message text", !blob.includes(secret),
      blob.includes(secret) ? "message text leaked into a notification body" : "");
    await ctx2.close();
  }

  // ------------------------------------------------------------ legal pages
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    attach(page, "legal");
    await page.goto(`${BASE}/privacy`, { waitUntil: "networkidle" });
    const priv = await page.evaluate(() => document.body.innerText);
    check("DISC-3", "Privacy policy names Vercel Analytics", /Vercel Analytics/i.test(priv));
    check("DISC-4", "Privacy policy no longer claims data can't identify users",
      !/we do not use it to identify individual users/i.test(priv));
    await page.goto(`${BASE}/terms`, { waitUntil: "networkidle" });
    check("UI-6", "Terms page renders", (await page.evaluate(() => document.body.innerText)).length > 200);
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  await cleanup(fx);
  await prisma.$disconnect();
}

// ------------------------------------------------------------------ report
const failed = results.filter((r) => !r.passed);
console.log(`\n${"=".repeat(64)}\nRESULT: ${results.length - failed.length}/${results.length} passed`);

// Noise the harness generates itself, or that only occurs off Vercel.
const NOISE = [
  "_vercel/insights", "_vercel/speed-insights", "ERR_TUNNEL_CONNECTION_FAILED",
  "status of 400", "status of 401", "status of 403", "status of 404", "status of 409", "status of 423", "status of 429",
];
const realErrors = [...new Set(consoleErrors)].filter((e) => !NOISE.some((n) => e.includes(n)));
if (realErrors.length) {
  console.log(`\nApp-origin console errors (${realErrors.length}):`);
  realErrors.slice(0, 15).forEach((e) => console.log("  " + e));
} else {
  console.log("No app-origin console errors.");
}

if (failed.length) {
  console.log(`\nFailed: ${failed.map((f) => f.id).join(", ")}`);
  process.exit(1);
}
