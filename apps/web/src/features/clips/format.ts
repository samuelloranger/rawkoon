/** "1:05" -> 65. Null when it is not minutes:seconds with seconds under 60. */
export function parseMmSs(input: string): number | null {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(input.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatMmSs(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
