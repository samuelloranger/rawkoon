export function formatListeningHours(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s === 0) return "0h";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
