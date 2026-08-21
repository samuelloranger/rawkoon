import { prisma } from "@rawkoon/api/db";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";

export interface ParsedChapter {
  index: number;
  title: string | null;
  startSecs: number;
  endSecs: number;
}

/**
 * MediaInfo reports m4b/mka chapter marks as a "Menu" track whose `extra` keys
 * are timecodes — `_00_12_43_500: "en:Chapter 2"`. There is no end time, so a
 * chapter ends where the next one starts and the last one ends at the file's
 * duration. mediainfo is already a runtime dependency, which is why this does
 * not reach for ffprobe.
 */
export const parseMenuTimecode = (key: string): number | null => {
  const m = /^_(\d{2})_(\d{2})_(\d{2})_(\d{1,3})$/.exec(key);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(ms) / 1000;
};

/** Strips MediaInfo's `en:` language prefix from a chapter title. */
const cleanTitle = (value: string): string | null => {
  const stripped = value.replace(/^[a-z]{2,3}:/i, "").trim();
  return stripped.length > 0 ? stripped : null;
};

export const parseMenuChapters = (
  raw: string,
  durationSecs: number | null,
): ParsedChapter[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const tracks = (parsed as { media?: { track?: Record<string, unknown>[] } })
    ?.media?.track;
  if (!Array.isArray(tracks)) return [];

  const menu = tracks.find((t) => t["@type"] === "Menu");
  const extra = menu?.extra;
  if (!extra || typeof extra !== "object") return [];

  const marks: { start: number; title: string | null }[] = [];
  for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
    const start = parseMenuTimecode(key);
    if (start == null) continue;
    marks.push({
      start,
      title: typeof value === "string" ? cleanTitle(value) : null,
    });
  }
  if (marks.length === 0) return [];

  marks.sort((a, b) => a.start - b.start);

  return marks.map((mark, i) => ({
    index: i,
    title: mark.title,
    startSecs: mark.start,
    // The last chapter runs to the end of the file. With no known duration it
    // gets a zero-length tail rather than a guess, and the player falls back to
    // the file's own timeline.
    endSecs: marks[i + 1]?.start ?? durationSecs ?? mark.start,
  }));
};

const runMediaInfo = async (filePath: string): Promise<string | null> => {
  const bin = Bun.which("mediainfo");
  if (!bin) return null;
  const proc = Bun.spawn([bin, "--Output=JSON", remapPath(filePath)], {
    stderr: "ignore",
  });
  const timeoutId = setTimeout(() => proc.kill(), 30_000);
  const raw = await new Response(proc.stdout).text();
  clearTimeout(timeoutId);
  const exitCode = await proc.exited;
  return exitCode !== 0 || !raw.trim() ? null : raw;
};

/**
 * Probe one audiobook file for chapter marks and replace its chapter rows.
 * Returns the number of chapters stored. Never throws: a file without chapters
 * is normal, and the player synthesises one chapter per file in that case.
 */
export const syncFileChapters = async (
  fileId: number,
  filePath: string,
  durationSecs: number | null,
): Promise<number> => {
  let chapters: ParsedChapter[] = [];
  try {
    const raw = await runMediaInfo(filePath);
    if (raw) chapters = parseMenuChapters(raw, durationSecs);
  } catch (err) {
    console.error("[bookFileChapters] probe failed:", err);
    return 0;
  }

  await prisma.$transaction([
    prisma.bookFileChapter.deleteMany({ where: { fileId } }),
    ...(chapters.length
      ? [
          prisma.bookFileChapter.createMany({
            data: chapters.map((c) => ({
              fileId,
              index: c.index,
              title: c.title,
              startSecs: c.startSecs,
              endSecs: c.endSecs,
            })),
          }),
        ]
      : []),
    prisma.bookFile.update({
      where: { id: fileId },
      data: { chapterCount: chapters.length || null },
    }),
  ]);

  return chapters.length;
};
