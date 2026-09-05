export interface ChapterAtom {
  title: string;
  startSecs: number;
  endSecs: number;
}

interface RawChapter {
  start_time?: string;
  end_time?: string;
  tags?: { title?: string };
}

/**
 * Embedded chapter atoms of a container (m4b/mp4/mka…), per ffprobe.
 *
 * A single-file audiobook keeps its chapter structure in the container's `moov`
 * atom, not in separate files. `-show_chapters` reads only that header, so this
 * is cheap even on a 500 MB book — the audio stream is never touched.
 *
 * Returns the atoms in file order, or null when the file has no embedded
 * chapters or ffprobe fails for any reason. Offsets are already whole-file
 * offsets (a single-file book has one file), so — unlike the per-file
 * durations that feed buildTimeline — they are not accumulated.
 */
export const probeChapterAtoms = async (
  path: string,
): Promise<ChapterAtom[] | null> => {
  try {
    const proc = Bun.spawn(
      [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_chapters",
        path,
      ],
      { stdout: "pipe", stderr: "ignore" },
    );
    const out = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) !== 0) {
      return null;
    }

    const parsed = JSON.parse(out) as { chapters?: RawChapter[] };
    const raw = parsed.chapters;
    if (!Array.isArray(raw) || raw.length === 0) {
      return null;
    }

    const atoms: ChapterAtom[] = [];
    for (const chapter of raw) {
      const startSecs = Number(chapter.start_time);
      const endSecs = Number(chapter.end_time);
      if (!Number.isFinite(startSecs) || !Number.isFinite(endSecs)) {
        return null;
      }
      atoms.push({
        title: chapter.tags?.title?.trim() ?? "",
        startSecs,
        endSecs,
      });
    }
    return atoms;
  } catch {
    // Bun.spawn throws synchronously if ffprobe is missing from PATH; JSON.parse
    // throws on malformed output. Both must resolve to null to preserve the
    // Promise<ChapterAtom[] | null> contract.
    return null;
  }
};
