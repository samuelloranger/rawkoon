/**
 * Clock formatting for the player. Hours appear only when the book has them,
 * so a 40-minute chapter does not read as `0:40:00`.
 */
export const formatClock = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

/** Remaining time, written as a countdown. */
export const formatRemaining = (position: number, duration: number): string =>
  `-${formatClock(Math.max(0, duration - position))}`;
