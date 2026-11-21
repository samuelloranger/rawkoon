/**
 * Parse a path segment as a whole number, or NaN when it isn't one. Unlike
 * parseInt, "12abc" and "1.5" are rejected; callers keep their `isFinite` guard.
 */
export function strictInt(raw: string | undefined, min = 1): number {
  const n = Number(raw);
  return raw?.trim() && Number.isInteger(n) && n >= min ? n : Number.NaN;
}
