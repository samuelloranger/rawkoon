import { inflateRawSync } from "node:zlib";

/**
 * Minimal read-only zip support: locate one entry by name and inflate it.
 *
 * Bun.Archive (1.4) only understands tar and tar.gz — handed a zip it throws
 * "Unrecognized archive format" — and there is no other zip API, so reading an
 * epub means either shelling out to `unzip` or parsing the container here.
 * Parsing it here keeps epub import working on hosts without `unzip` and costs
 * no subprocesses.
 *
 * Only what an epub needs is implemented: the end-of-central-directory record,
 * the central directory, and stored/deflate entries. Zip64 and encrypted
 * entries are detected and refused rather than mis-parsed.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Fixed size of each record, excluding the variable-length fields that follow. */
const EOCD_FIXED_SIZE = 22;
const CENTRAL_FIXED_SIZE = 46;
const LOCAL_FIXED_SIZE = 30;

/** A zip comment is a uint16 length, so the EOCD starts at most this far back. */
const MAX_EOCD_SEARCH = EOCD_FIXED_SIZE + 0xffff;

/** Marker used in place of a real size or offset when the value needs zip64. */
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** General-purpose bit 0 means the entry is encrypted. */
const FLAG_ENCRYPTED = 0x1;

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

async function readRange(
  path: string,
  start: number,
  end: number,
): Promise<Buffer> {
  const bytes = await Bun.file(path).slice(start, end).arrayBuffer();
  return Buffer.from(bytes);
}

/**
 * Find the end-of-central-directory record and return the central directory's
 * offset and size, or null when this is not a (non-zip64) zip.
 */
async function readEocd(
  path: string,
  fileSize: number,
): Promise<{ offset: number; size: number; entryCount: number } | null> {
  if (fileSize < EOCD_FIXED_SIZE) return null;

  const searchLength = Math.min(fileSize, MAX_EOCD_SEARCH);
  const tail = await readRange(path, fileSize - searchLength, fileSize);

  // Scan backwards: the EOCD is last except for its own trailing comment.
  for (let i = tail.length - EOCD_FIXED_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;

    const commentLength = tail.readUInt16LE(i + 20);
    if (i + EOCD_FIXED_SIZE + commentLength !== tail.length) continue;

    const entryCount = tail.readUInt16LE(i + 10);
    const size = tail.readUInt32LE(i + 12);
    const offset = tail.readUInt32LE(i + 16);

    // Any sentinel means the real value lives in a zip64 record we do not read.
    if (
      entryCount === ZIP64_SENTINEL_16 ||
      size === ZIP64_SENTINEL_32 ||
      offset === ZIP64_SENTINEL_32
    ) {
      return null;
    }
    if (offset + size > fileSize) return null;

    return { offset, size, entryCount };
  }

  return null;
}

/** List the entries in a zip's central directory. Returns [] if unreadable. */
export async function listZipEntries(path: string): Promise<ZipEntry[]> {
  try {
    const fileSize = Bun.file(path).size;
    const eocd = await readEocd(path, fileSize);
    if (!eocd) return [];

    const central = await readRange(path, eocd.offset, eocd.offset + eocd.size);
    const entries: ZipEntry[] = [];

    let cursor = 0;
    while (entries.length < eocd.entryCount) {
      if (cursor + CENTRAL_FIXED_SIZE > central.length) break;
      if (central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;

      const flags = central.readUInt16LE(cursor + 8);
      const compressionMethod = central.readUInt16LE(cursor + 10);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const localHeaderOffset = central.readUInt32LE(cursor + 42);

      const nameStart = cursor + CENTRAL_FIXED_SIZE;
      const nameEnd = nameStart + nameLength;
      if (nameEnd > central.length) break;

      // Sizes or offsets needing zip64 are stored in the extra field; skip
      // rather than read the sentinel as a real value.
      const needsZip64 =
        compressedSize === ZIP64_SENTINEL_32 ||
        uncompressedSize === ZIP64_SENTINEL_32 ||
        localHeaderOffset === ZIP64_SENTINEL_32;

      if (!needsZip64) {
        entries.push({
          // Entry names are UTF-8 when bit 11 is set and otherwise CP437; epub
          // requires UTF-8, and OPF paths are ASCII in practice either way.
          name: central.toString("utf8", nameStart, nameEnd),
          compressionMethod,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
          encrypted: (flags & FLAG_ENCRYPTED) !== 0,
        });
      }

      cursor = nameEnd + extraLength + commentLength;
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Read and decompress one entry's bytes. Returns null when the entry cannot be
 * read — an unsupported compression method, encryption, or a corrupt header.
 */
export async function readZipEntry(
  path: string,
  entry: ZipEntry,
): Promise<Buffer | null> {
  if (entry.encrypted) return null;
  if (
    entry.compressionMethod !== METHOD_STORED &&
    entry.compressionMethod !== METHOD_DEFLATE
  ) {
    return null;
  }

  try {
    // The local header repeats the name and carries its own extra field, whose
    // length can differ from the central directory's — so read it, don't guess.
    const header = await readRange(
      path,
      entry.localHeaderOffset,
      entry.localHeaderOffset + LOCAL_FIXED_SIZE,
    );
    if (header.length < LOCAL_FIXED_SIZE) return null;
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) return null;

    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const dataStart =
      entry.localHeaderOffset + LOCAL_FIXED_SIZE + nameLength + extraLength;

    const compressed = await readRange(
      path,
      dataStart,
      dataStart + entry.compressedSize,
    );
    if (compressed.length !== entry.compressedSize) return null;

    if (entry.compressionMethod === METHOD_STORED) return compressed;
    return inflateRawSync(compressed);
  } catch {
    return null;
  }
}

/**
 * Read the first entry whose name satisfies `match`, as UTF-8 text.
 * Returns null when no entry matches or the entry cannot be decompressed.
 */
export async function readZipEntryText(
  path: string,
  match: (name: string) => boolean,
): Promise<string | null> {
  const entry = (await listZipEntries(path)).find((e) => match(e.name));
  if (!entry) return null;

  const bytes = await readZipEntry(path, entry);
  return bytes ? bytes.toString("utf8") : null;
}
