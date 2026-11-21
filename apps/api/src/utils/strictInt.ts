/**
 * Parse a path segment as a whole number, or NaN when it isn't one. Unlike
 * parseInt, "12abc" and "1.5" are rejected; callers keep their `isFinite` guard.
 */
export function strictInt(raw: string | undefined, min = 1): number {
  // Digits only: Number() alone would take "0x10", "1e3" and "+5".
  if (!raw || !/^\d+$/.test(raw)) return Number.NaN;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min ? n : Number.NaN;
}
