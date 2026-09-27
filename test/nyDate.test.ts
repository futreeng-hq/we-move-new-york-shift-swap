import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { nyToday, parseDateOnly, validateSwapDate, oneYearOut } from "../lib/nyDate";

afterEach(() => mock.timers.reset());

test("parseDateOnly accepts strict YYYY-MM-DD as midnight UTC", () => {
  const d = parseDateOnly("2026-07-04");
  assert.ok(d);
  assert.equal(d.toISOString(), "2026-07-04T00:00:00.000Z");
});

test("parseDateOnly rejects non-date-only strings", () => {
  assert.equal(parseDateOnly(""), null);
  assert.equal(parseDateOnly("2026-7-4"), null);
  assert.equal(parseDateOnly("2026/07/04"), null);
  assert.equal(parseDateOnly("2026-07-04T10:00:00Z"), null); // the ISO-with-time ambiguity we reject
  assert.equal(parseDateOnly("garbage"), null);
  assert.equal(parseDateOnly("2026-13-40"), null); // well-formed but impossible calendar date
});

// 2026-07-04T01:00:00Z == 2026-07-03 21:00 EDT. This is the exact window the
// old `new Date()` comparison got wrong: UTC has rolled to the 4th but it is
// still the 3rd in New York.
test("nyToday: at 21:00 EDT the NY calendar date is still the same day", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 6, 4, 1, 0, 0) });
  assert.equal(nyToday().toISOString(), "2026-07-03T00:00:00.000Z");
});

test("nyToday: at 08:00 EDT the NY calendar date matches UTC date", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 6, 4, 12, 0, 0) });
  assert.equal(nyToday().toISOString(), "2026-07-04T00:00:00.000Z");
});

// Acceptance scenario from the work order: simulated 21:00 EDT on Jul 3.
test("validateSwapDate boundaries at simulated 21:00 EDT (today = Jul 3 NY)", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 6, 4, 1, 0, 0) });
  const today = nyToday();
  const yearOut = oneYearOut(today);
  assert.equal(today.toISOString(), "2026-07-03T00:00:00.000Z");

  // posting tomorrow (NY) succeeds
  assert.equal(validateSwapDate("date", "2026-07-04", today, yearOut), null);
  // posting today (NY) succeeds — the whole point of A2
  assert.equal(validateSwapDate("date", "2026-07-03", today, yearOut), null);
  // posting yesterday (NY) fails
  assert.equal(validateSwapDate("date", "2026-07-02", today, yearOut), "date cannot be in the past");
});

// ---------------------------------------------------------------------------
// EST (winter) and the DST transitions.
//
// Every clock faked above is in July, i.e. EDT (UTC-4) only. The launch
// readiness checklist asks for "New York calendar-date behavior across both EST
// and EDT"; these lock in the UTC-5 offset and both transition days, so a
// regression to naive UTC date math or server-local time fails here instead of
// in production in November.
// ---------------------------------------------------------------------------

test("nyToday: at 20:00 EST (UTC-5) the NY calendar date is still the same day", () => {
  // 2026-01-16T01:00:00Z == 2026-01-15 20:00 EST. UTC has rolled to the 16th.
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 16, 1, 0, 0) });
  assert.equal(nyToday().toISOString(), "2026-01-15T00:00:00.000Z");
});

test("nyToday: EST boundary — 04:59Z is the previous NY day, 05:00Z is the new one", () => {
  // Under UTC-5, NY midnight falls at 05:00Z.
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 16, 4, 59, 59) });
  assert.equal(nyToday().toISOString(), "2026-01-15T00:00:00.000Z");
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 16, 5, 0, 0) });
  assert.equal(nyToday().toISOString(), "2026-01-16T00:00:00.000Z");
});

test("nyToday: EDT boundary — 03:59Z is the previous NY day, 04:00Z is the new one", () => {
  // Under UTC-4, NY midnight falls at 04:00Z — an hour earlier than in winter.
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 6, 4, 3, 59, 59) });
  assert.equal(nyToday().toISOString(), "2026-07-03T00:00:00.000Z");
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 6, 4, 4, 0, 0) });
  assert.equal(nyToday().toISOString(), "2026-07-04T00:00:00.000Z");
});

test("nyToday: spring-forward day (2026-03-08) resolves to one calendar date", () => {
  // 02:00 EST -> 03:00 EDT on 2026-03-08. 06:30Z is 01:30 EST, inside the
  // pre-transition hour; 07:30Z is 03:30 EDT, after it. Both are March 8 in NY.
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 2, 8, 6, 30, 0) });
  assert.equal(nyToday().toISOString(), "2026-03-08T00:00:00.000Z");
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 2, 8, 7, 30, 0) });
  assert.equal(nyToday().toISOString(), "2026-03-08T00:00:00.000Z");
});

test("nyToday: fall-back day (2026-11-01) — the repeated 01:30 hour stays Nov 1", () => {
  // 02:00 EDT -> 01:00 EST on 2026-11-01, so 01:30 local happens twice:
  // 05:30Z (EDT) and 06:30Z (EST). Neither may roll the calendar date.
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 1, 5, 30, 0) });
  assert.equal(nyToday().toISOString(), "2026-11-01T00:00:00.000Z");
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 1, 6, 30, 0) });
  assert.equal(nyToday().toISOString(), "2026-11-01T00:00:00.000Z");
});

test("validateSwapDate: same-day posting works in EST too, not just EDT", () => {
  // 2026-01-16T02:00:00Z == 2026-01-15 21:00 EST: the winter version of the
  // window the original UTC bug got wrong.
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 16, 2, 0, 0) });
  const today = nyToday();
  const yearOut = oneYearOut(today);
  assert.equal(today.toISOString(), "2026-01-15T00:00:00.000Z");
  assert.equal(validateSwapDate("date", "2026-01-15", today, yearOut), null);
  assert.equal(validateSwapDate("date", "2026-01-16", today, yearOut), null);
  assert.equal(validateSwapDate("date", "2026-01-14", today, yearOut), "date cannot be in the past");
});

test("oneYearOut across a DST change keeps the same calendar day-of-month", () => {
  // Jan -> Jan and Jul -> Jul: adding a year must not drift by the offset
  // difference, which naive millisecond arithmetic would do.
  assert.equal(oneYearOut(parseDateOnly("2026-01-15")!).toISOString(), "2027-01-15T00:00:00.000Z");
  assert.equal(oneYearOut(parseDateOnly("2026-07-03")!).toISOString(), "2027-07-03T00:00:00.000Z");
  // Leap-day start: 2028 is a leap year, 2029 is not.
  assert.equal(oneYearOut(parseDateOnly("2028-02-29")!).toISOString(), "2029-03-01T00:00:00.000Z");
});

test("validateSwapDate: one-year boundary is inclusive, beyond it fails", () => {
  const today = parseDateOnly("2026-07-03")!;
  const yearOut = oneYearOut(today);
  assert.equal(yearOut.toISOString(), "2027-07-03T00:00:00.000Z");
  assert.equal(validateSwapDate("date", "2027-07-03", today, yearOut), null); // exactly 1 year — allowed
  assert.equal(
    validateSwapDate("date", "2027-07-04", today, yearOut),
    "date cannot be more than 1 year from now",
  );
});

test("validateSwapDate: absent field is valid, malformed field is rejected", () => {
  const today = parseDateOnly("2026-07-03")!;
  const yearOut = oneYearOut(today);
  assert.equal(validateSwapDate("fromDate", undefined, today, yearOut), null);
  assert.equal(validateSwapDate("fromDate", "", today, yearOut), null);
  assert.equal(validateSwapDate("fromDate", "07/03/2026", today, yearOut), "Invalid fromDate");
});
