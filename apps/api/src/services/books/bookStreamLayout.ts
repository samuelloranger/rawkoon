import { open, stat } from "node:fs/promises";

/**
 * A multi-file audiobook as one seekable resource.
 *
 * The player used to flatten N files into a virtual timeline in JavaScript —
 * mapping a position to (file, offset), swapping `src` at every boundary and
 * queueing seeks on `loadedmetadata`. Every playback bug reported lived in that
 * seam. A stock <audio> element gets none of it wrong; it only needs one
 * seekable resource, which is what this builds.
 *
 * Concatenating the audio payloads of CBR mp3 files that share codec, sample
 * rate, channel count and bitrate yields a valid mp3 stream whose byte offsets
 * map linearly to time, so the browser's own seeking lands accurately. The ID3v2
 * headers are the one thing that must not survive: mid-stream they are garbage
 * frames between chapters.
 */

/** One file's contribution to the virtual stream. */
export interface StreamPart {
  fileId: number;
  path: string;
  /** Bytes to skip at the head of the file — its ID3v2 tag. */
  skip: number;
  /** Audio payload length, i.e. size - skip - any trailing tag. */
  length: number;
  /** Where this part starts in the virtual byte space. */
  offset: number;
}

export interface StreamLayout {
  parts: StreamPart[];
  totalBytes: number;
  /** Cheap validator: changes when any underlying file is replaced. */
  etag: string;
}

/**
 * ID3v2 header length, or 0 when there is none.
 *
 * The size is a 28-bit synchsafe integer — seven bits per byte, high bit always
 * clear — so it cannot be read as a plain big-endian number. Ten bytes of
 * header sit in front of the size it declares.
 */
export const id3v2Length = (header: Uint8Array): number => {
  if (header.length < 10) return 0;
  if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return 0; // "ID3"
  const size =
    ((header[6] & 0x7f) << 21) |
    ((header[7] & 0x7f) << 14) |
    ((header[8] & 0x7f) << 7) |
    (header[9] & 0x7f);
  // A footer is present when bit 4 of the flags byte is set; it is another 10.
  const footer = (header[5] & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
};

/** ID3v1 is a fixed 128-byte trailer starting with "TAG". */
export const hasId3v1 = (trailer: Uint8Array): boolean =>
  trailer.length === 128 &&
  trailer[0] === 0x54 &&
  trailer[1] === 0x41 &&
  trailer[2] === 0x47;

/**
 * Which slices of which files satisfy a virtual byte range.
 *
 * Pure, and the only arithmetic that matters — a boundary off by one byte is a
 * click between chapters at best and a decode error at worst. `end` is
 * inclusive, matching the Range header it comes from.
 */
export interface StreamSlice {
  path: string;
  /** Absolute byte offset within the real file. */
  start: number;
  /** Exclusive, so it can be handed straight to a file slice. */
  end: number;
}

export const sliceLayout = (
  layout: StreamLayout,
  start: number,
  end: number,
): StreamSlice[] => {
  const slices: StreamSlice[] = [];
  if (start > end) return slices;
  for (const part of layout.parts) {
    const partStart = part.offset;
    const partEnd = part.offset + part.length - 1;
    if (partEnd < start) continue;
    if (partStart > end) break;
    // Where the wanted range falls inside this part, then shifted past the tag
    // this part's audio payload begins after.
    const from = Math.max(start, partStart) - partStart;
    const to = Math.min(end, partEnd) - partStart;
    slices.push({
      path: part.path,
      start: part.skip + from,
      end: part.skip + to + 1,
    });
  }
  return slices;
};

/** Reads the tag sizes a file contributes so its payload can be isolated. */
const measure = async (
  path: string,
): Promise<{
  size: number;
  skip: number;
  length: number;
  validator: string;
}> => {
  const info = await stat(path);
  const handle = await open(path, "r");
  try {
    const head = new Uint8Array(10);
    await handle.read(head, 0, 10, 0);
    const skip = id3v2Length(head);

    let trailing = 0;
    if (info.size >= 128) {
      const tail = new Uint8Array(128);
      await handle.read(tail, 0, 128, info.size - 128);
      if (hasId3v1(tail)) trailing = 128;
    }

    const length = Math.max(0, info.size - skip - trailing);
    return {
      size: info.size,
      skip,
      length,
      validator: `${info.ino}-${Math.trunc(info.mtimeMs)}-${info.size}`,
    };
  } finally {
    await handle.close();
  }
};

/**
 * Builds the layout. Files must already be in playback order — the manifest's
 * natural name sort — because their order IS the timeline.
 */
export const buildStreamLayout = async (
  files: Array<{ id: number; filePath: string }>,
): Promise<StreamLayout> => {
  const parts: StreamPart[] = [];
  const validators: string[] = [];
  let offset = 0;

  for (const file of files) {
    const measured = await measure(file.filePath);
    // A file that is all tag and no audio would otherwise occupy zero bytes and
    // make the layout claim a duration it cannot serve.
    if (measured.length === 0) continue;
    parts.push({
      fileId: file.id,
      path: file.filePath,
      skip: measured.skip,
      length: measured.length,
      offset,
    });
    offset += measured.length;
    validators.push(`${file.id}:${measured.validator}`);
  }

  return {
    parts,
    totalBytes: offset,
    etag: `"concat-${hashValidators(validators)}"`,
  };
};

/**
 * FNV-1a over the per-file validators. Not security — this only has to change
 * when a file is replaced, and it has to stay short enough for a header.
 */
const hashValidators = (validators: string[]): string => {
  let hash = 0x811c9dc5;
  const joined = validators.join("|");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${validators.length}-${hash.toString(16)}`;
};

/**
 * Whether an edition's files can be served as one stream.
 *
 * Sample rate and channel count are not stored, so this is inferred from what
 * is: one format across every file, and one non-null bitrate shared by all.
 * VBR is excluded by construction — byte-to-time is not linear there, so the
 * browser would seek to the wrong place.
 */
export const isConcatEligible = (
  files: Array<{ format: string; audioBitrate: number | null }>,
): boolean => {
  if (files.length < 2) return false;
  const [first] = files;
  if (first.format !== "mp3") return false;
  if (first.audioBitrate == null) return false;
  return files.every(
    (f) => f.format === first.format && f.audioBitrate === first.audioBitrate,
  );
};
