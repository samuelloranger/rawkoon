export interface TimelineInput {
  title: string;
  durationSecs: number;
}

export interface TimelineChapter {
  index: number;
  title: string;
  startSecs: number;
  endSecs: number;
}

/**
 * Turn per-file durations into whole-book chapter offsets.
 *
 * Each chapter starts exactly where the previous one ended, so the timeline has
 * no gaps and no overlaps by construction. The durations must come from probing
 * the files that will actually be played — see bookTimeline.test.ts for why the
 * source chapter atoms are not an acceptable substitute.
 */
export const buildTimeline = (entries: TimelineInput[]): TimelineChapter[] => {
  const chapters: TimelineChapter[] = [];
  let cursor = 0;
  for (const [index, entry] of entries.entries()) {
    const startSecs = cursor;
    cursor += entry.durationSecs;
    chapters.push({ index, title: entry.title, startSecs, endSecs: cursor });
  }
  return chapters;
};
