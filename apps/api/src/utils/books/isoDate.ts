/**
 * Strict ISO date parsing for operator input.
 *
 * `new Date` silently normalizes nonsense rather than rejecting it:
 * "2024-02-30" becomes 1 March, and "0" parses to an epoch date. A publication
 * date is documented and rendered as an ISO date, so a typo must be refused —
 * saving it as a different day and reporting success is worse than an error.
 *
 * Only the date is kept, but the time is still validated rather than skimmed.
 * Matching the *shape* of a timestamp and ignoring its values accepts
 * "2024-06-27T25:00:00Z" and stores it as 27 June, which is the same
 * silent-acceptance problem one step further along.
 */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):?(\d{2}))?)?$/;

const inRange = (v: string | undefined, max: number): boolean =>
  v === undefined || Number(v) <= max;

export function parseIsoDate(raw: string): Date | null {
  const m = ISO_DATE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, , offHh, offMm] = m;

  // Clock and offset ranges, not just digit counts.
  if (!inRange(hh, 23) || !inRange(mi, 59) || !inRange(ss, 59)) return null;
  if (!inRange(offHh, 23) || !inRange(offMm, 59)) return null;

  const date = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Round-trip the components: a normalized date is not the date that was typed.
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() + 1 !== Number(mo) ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}
