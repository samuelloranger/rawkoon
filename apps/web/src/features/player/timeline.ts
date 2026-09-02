import type { BookManifestChapter } from "@rawkoon/shared/types";

export type Timeline = ReturnType<typeof createTimeline>;

export function createTimeline(chapters: BookManifestChapter[]) {
  const sorted = [...chapters].sort((a, b) => a.index - b.index);
  const totalDurationSecs =
    sorted.length === 0 ? 0 : sorted[sorted.length - 1].end_secs;

  const chapterAt = (positionSecs: number) => {
    if (positionSecs < 0 || positionSecs >= totalDurationSecs) return null;
    return (
      sorted.find(
        (c) => positionSecs >= c.start_secs && positionSecs < c.end_secs,
      ) ?? null
    );
  };

  return {
    chapters: sorted,
    totalDurationSecs,
    chapterAt,
    offsetWithinChapter: (positionSecs: number) => {
      const c = chapterAt(positionSecs);
      if (!c) return null;
      return { index: c.index, offsetSecs: positionSecs - c.start_secs };
    },
    clamp: (positionSecs: number) =>
      Math.min(Math.max(positionSecs, 0), totalDurationSecs),
    boundaryAfter: (positionSecs: number) =>
      sorted.find((c) => c.start_secs > positionSecs)?.start_secs,
    boundaryBefore: (positionSecs: number) =>
      [...sorted].reverse().find((c) => c.start_secs < positionSecs)
        ?.start_secs,
  };
}
