function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isInsideWindow(now: Date, start: string, end: string): boolean {
  const s = minutes(start);
  const e = minutes(end);
  const n = now.getHours() * 60 + now.getMinutes();
  if (s === e) return true;
  return s < e ? n >= s && n < e : n >= s || n < e;
}

export function positionBetween(
  prev: number | null,
  next: number | null,
): number {
  if (prev == null && next == null) return 1;
  if (prev == null) return (next as number) - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

export function blockToTop(minQueued: number | null, count: number): number[] {
  const start = (minQueued ?? count + 1) - count;
  return Array.from({ length: count }, (_, i) => start + i);
}
