import type { BookManifestFile } from "@rawkoon/shared/types";

export type FileIndex = ReturnType<typeof createFileIndex>;

/**
 * Physical-file lookup over a manifest. The <audio> element plays one file at
 * a time; chapters are only timeline markers (see timeline.ts).
 */
export function createFileIndex(files: BookManifestFile[]) {
  const sorted = [...files].sort((a, b) => a.start_secs - b.start_secs);

  const fileAt = (positionSecs: number): BookManifestFile | null =>
    sorted.find(
      (file) =>
        positionSecs >= file.start_secs &&
        positionSecs < file.start_secs + file.duration_secs,
    ) ?? null;

  return {
    files: sorted,
    fileAt,
    boundaryAfterFile: (positionSecs: number): number | null =>
      sorted.find((file) => file.start_secs > positionSecs)?.start_secs ?? null,
  };
}
