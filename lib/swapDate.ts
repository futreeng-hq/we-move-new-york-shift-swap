/**
 * Display parsing for swap date fields.
 *
 * Swap dates are `@db.Date` columns, so Prisma hands back a Date and the API
 * serializes it as a full ISO instant at midnight UTC — "2026-09-26T00:00:00.000Z",
 * not "2026-09-26". Two things went wrong with that downstream:
 *
 *   1. The UI appended "T12:00" to the value to pin it to local noon. That
 *      works on a bare "YYYY-MM-DD" but produces "…000ZT12:00" on an ISO
 *      string, which is an Invalid Date. Users saw the literal text
 *      "Invalid Date" on every Swap Days Off card, and the URGENT badge — whose
 *      threshold is computed from the same value — could never fire, silently.
 *
 *   2. Parsing the ISO string directly instead is not a fix: midnight UTC
 *      rendered in America/New_York is 8pm the PREVIOUS day, so every date in
 *      the app would read one day early — much worse than an obvious error,
 *      because it looks plausible.
 *
 * Taking the calendar date out of the string and re-anchoring it at local noon
 * handles both shapes and cannot roll across a day boundary in any timezone
 * the app is used in.
 */

/** Accepts a Date, a bare "YYYY-MM-DD", or a full ISO string. Null when unparseable. */
export function parseSwapDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;

  const isoDay =
    value instanceof Date
      ? (isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10))
      : /^\d{4}-\d{2}-\d{2}/.test(value)
        ? value.slice(0, 10)
        : null;

  if (!isoDay) return null;

  const d = new Date(`${isoDay}T12:00`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats a swap date for display, or returns "" when there is nothing to show.
 * Never returns the string "Invalid Date".
 */
export function formatSwapDate(
  value: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
  locale = "en-US",
): string {
  const d = parseSwapDate(value);
  return d ? d.toLocaleDateString(locale, opts) : "";
}
