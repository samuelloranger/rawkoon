import { inflateRawSync } from "node:zlib";

/** Minimal read-only zip support for epubs, since Bun.Archive only reads tar; zip64 and encrypted entries are refused. */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

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

/** Ceiling per entry, compressed or inflated: epubs are untrusted and deflate reaches ~1000:1. */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/** Ceiling on the central directory, which is read whole; its declared uint32 size could ask for 4 GiB. */
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;

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

/** Returns the central directory's offset and size, or null when this is not a non-zip64 zip. */
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

    // A sentinel means the real value is in a zip64 record we do not read.
    if (
      entryCount === ZIP64_SENTINEL_16 ||
      size === ZIP64_SENTINEL_32 ||
      offset === ZIP64_SENTINEL_32
    ) {
      return null;
    }
    if (offset + size > fileSize) return null;
    if (size > MAX_CENTRAL_DIRECTORY_BYTES) return null;

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

      // Zip64 values live in the extra field; skip rather than read the sentinel as real.
      const needsZip64 =
        compressedSize === ZIP64_SENTINEL_32 ||
        uncompressedSize === ZIP64_SENTINEL_32 ||
        localHeaderOffset === ZIP64_SENTINEL_32;

      if (!needsZip64) {
        entries.push({
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

/** Returns null when the entry cannot be read: unsupported method, encryption, or corrupt header. */
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
  // Refuse on declared sizes first; the inflate is capped too since a hostile entry can understate them.
  if (
    entry.compressedSize > MAX_ENTRY_BYTES ||
    entry.uncompressedSize > MAX_ENTRY_BYTES
  ) {
    return null;
  }

  try {
    // The local header's extra field length can differ from the central directory's, so read it.
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
    // maxOutputLength throws instead of allocating, which stops a zip bomb that lies about its size.
    return inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
  } catch {
    return null;
  }
}

/** Reads the first entry matching `match` as UTF-8, or null if none matches or it cannot be decompressed. */
export async function readZipEntryText(
  path: string,
  match: (name: string) => boolean,
): Promise<string | null> {
  const entry = (await listZipEntries(path)).find((e) => match(e.name));
  if (!entry) return null;

  const bytes = await readZipEntry(path, entry);
  return bytes ? bytes.toString("utf8") : null;
}
