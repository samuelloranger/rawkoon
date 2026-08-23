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

/**
 * Largest body served for one range request.
 *
 * A media element opens with `Range: bytes=0-`, which means "the rest of the
 * resource" — 821MB for a 9h30m audiobook. Answering fewer bytes than asked
 * for is explicitly allowed: the client reads Content-Range and asks again.
 * About two and a half minutes of 192kbps audio.
 */
export const MAX_RANGE_BYTES = 4 * 1024 * 1024;

/**
 * Reads the bytes for a set of slices.
 *
 * Deliberately node:fs with explicit offsets rather than `Bun.file().slice()`.
 * On Bun 1.4.0 a sliced BunFile loses its bounds on the way out: `.stream()`
 * yields the whole file, and `Bun.serve`'s sendfile path ignores the offset
 * too — so a 206 promising `bytes 5000-5999` delivered the file from byte zero.
 * A media element asking for the middle of a chapter received its beginning,
 * which is what made seeking rewind and scrubbing do nothing at all.
 *
 * Returning a buffer rather than a stream also restores Content-Length: Bun
 * drops a manually set one when the body is a ReadableStream and falls back to
 * chunked encoding, which media elements handle far less well.
 */
export const readSlices = async (
  slices: StreamSlice[],
): Promise<Uint8Array> => {
  const total = slices.reduce((n, s) => n + (s.end - s.start), 0);
  const out = new Uint8Array(total);
  let written = 0;

  for (const slice of slices) {
    const handle = await open(slice.path, "r");
    try {
      const want = slice.end - slice.start;
      let read = 0;
      while (read < want) {
        const { bytesRead } = await handle.read(
          out,
          written + read,
          want - read,
          slice.start + read,
        );
        // A file shorter than the layout claims — truncated or replaced under
        // us. Serve what exists rather than a buffer padded with zeros, which
        // would decode as silence.
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      written += read;
    } finally {
      await handle.close();
    }
  }

  return written === total ? out : out.subarray(0, written);
};

/** Read granularity for a whole-resource response. */
const STREAM_CHUNK = 256 * 1024;

/**
 * Streams every slice in order, for a request that asked for no range.
 *
 * A 206 may only answer a Range request — an unsolicited one is a protocol
 * violation, and a media element refuses to start on it. So a bare GET has to
 * be answered with the whole resource, which for a 9h30m audiobook is 821MB
 * and cannot be buffered. Read in bounded chunks with explicit offsets, for the
 * same reason readSlices does: a sliced BunFile does not keep its bounds.
 *
 * In practice both Chromium and WebKit open a media resource with
 * `Range: bytes=0-`, so this path serves curl and the unusual client.
 */
export const streamSlices = (
  slices: StreamSlice[],
): ReadableStream<Uint8Array> => {
  let index = 0;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let position = 0;

  const closeHandle = async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (index >= slices.length) {
          await closeHandle();
          controller.close();
          return;
        }
        const slice = slices[index];
        if (!handle) {
          handle = await open(slice.path, "r");
          position = slice.start;
        }
        const remaining = slice.end - position;
        if (remaining <= 0) {
          await closeHandle();
          index++;
          continue;
        }
        const size = Math.min(STREAM_CHUNK, remaining);
        const buffer = new Uint8Array(size);
        const { bytesRead } = await handle.read(buffer, 0, size, position);
        if (bytesRead === 0) {
          // Short file: move on rather than spin.
          await closeHandle();
          index++;
          continue;
        }
        position += bytesRead;
        controller.enqueue(
          bytesRead === size ? buffer : buffer.subarray(0, bytesRead),
        );
        return;
      }
    },
    async cancel() {
      // A client that seeks away abandons the response; release the handle.
      await closeHandle();
    },
  });
};
