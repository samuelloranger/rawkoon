/**
 * Strict ISO date parsing for operator input.
 *
 * `new Date` silently normalizes nonsense rather than rejecting it:
 * "2024-02-30" becomes 1 March, and "0" parses to an epoch date. A publication
 * date is documented and rendered as an ISO date, so a typo must be refused —
 * saving it as a different day and reporting success is worse than an error.
 *
 * The time part is matched in full rather than skipped over. A permissive
 * "anything after the date" suffix accepts "2024-06-27Tnot-a-date" and stores
 * it as 27 June, which is the same silent-acceptance problem in a new place.
 */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseIsoDate(raw: string): Date | null {
  const m = ISO_DATE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
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
