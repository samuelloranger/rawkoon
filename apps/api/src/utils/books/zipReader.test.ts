import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";
import {
  listZipEntries,
  readZipEntry,
  readZipEntryText,
} from "@rawkoon/api/utils/books/zipReader";

/**
 * Builds zips by hand so the tests do not depend on the `unzip`/`zip` binaries
 * being installed — the whole point of the reader is to not need them.
 */
interface BuildEntry {
  name: string;
  content: string;
  /** Stored (0) or deflate (8). Anything else is written verbatim to test refusal. */
  method?: number;
  comment?: string;
}

function buildZip(entries: BuildEntry[], archiveComment = ""): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const raw = Buffer.from(entry.content, "utf8");
    const body = method === 0 ? raw : deflateRawSync(raw);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, body);

    const comment = Buffer.from(entry.comment ?? "", "utf8");
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(comment.length, 32);
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name, comment);

    offset += local.length + name.length + body.length;
  }

  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(centrals);
  const comment = Buffer.from(archiveComment, "utf8");

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localBytes.length, 16);
  eocd.writeUInt16LE(comment.length, 20);

  return Buffer.concat([localBytes, centralBytes, eocd, comment]);
}

const OPF = `<?xml version="1.0"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>Le Fantôme &amp; l'Opéra</dc:title>
    <dc:creator>Gaston Leroux</dc:creator>
  </metadata>
</package>`;

let dir: string;
const write = async (name: string, bytes: Buffer): Promise<string> => {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rawkoon-zip-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listZipEntries", () => {
  it("lists every entry with its sizes and offsets", async () => {
    const path = await write(
      "basic.epub",
      buildZip([
        { name: "mimetype", content: "application/epub+zip", method: 0 },
        { name: "OEBPS/content.opf", content: OPF },
      ]),
    );

    const entries = await listZipEntries(path);
    expect(entries.map((e) => e.name)).toEqual([
      "mimetype",
      "OEBPS/content.opf",
    ]);
    expect(entries[0].compressionMethod).toBe(0);
    expect(entries[1].compressionMethod).toBe(8);
    expect(entries[1].uncompressedSize).toBe(Buffer.byteLength(OPF));
    expect(entries[0].encrypted).toBe(false);
  });

  it("finds the EOCD behind a trailing archive comment", async () => {
    const path = await write(
      "commented.epub",
      buildZip([{ name: "a.opf", content: OPF }], "x".repeat(500)),
    );
    expect((await listZipEntries(path)).map((e) => e.name)).toEqual(["a.opf"]);
  });

  it("returns [] for a file that is not a zip", async () => {
    const path = await write("not.epub", Buffer.from("just some bytes here"));
    expect(await listZipEntries(path)).toEqual([]);
  });

  it("returns [] for an empty file", async () => {
    const path = await write("empty.epub", Buffer.alloc(0));
    expect(await listZipEntries(path)).toEqual([]);
  });

  it("returns [] for a missing file instead of throwing", async () => {
    expect(await listZipEntries(join(dir, "nope.epub"))).toEqual([]);
  });

  it("returns [] when the central directory offset is out of range", async () => {
    const bytes = buildZip([{ name: "a.opf", content: OPF }]);
    // The EOCD is the last 22 bytes (no archive comment): corrupt its offset.
    bytes.writeUInt32LE(0xfffffff0, bytes.length - 6);
    const path = await write("badoffset.epub", bytes);
    expect(await listZipEntries(path)).toEqual([]);
  });
});

describe("readZipEntry", () => {
  it("inflates a deflated entry", async () => {
    const path = await write(
      "deflate.epub",
      buildZip([{ name: "OEBPS/content.opf", content: OPF }]),
    );
    const [entry] = await listZipEntries(path);
    expect((await readZipEntry(path, entry))?.toString("utf8")).toBe(OPF);
  });

  it("returns a stored entry verbatim", async () => {
    const path = await write(
      "stored.epub",
      buildZip([
        { name: "mimetype", content: "application/epub+zip", method: 0 },
      ]),
    );
    const [entry] = await listZipEntries(path);
    expect((await readZipEntry(path, entry))?.toString("utf8")).toBe(
      "application/epub+zip",
    );
  });

  it("reads an entry that is not the first in the archive", async () => {
    const path = await write(
      "multi.epub",
      buildZip([
        { name: "mimetype", content: "application/epub+zip", method: 0 },
        { name: "META-INF/container.xml", content: "<container/>" },
        { name: "OEBPS/content.opf", content: OPF },
      ]),
    );
    const entries = await listZipEntries(path);
    const opf = entries.find((e) => e.name.endsWith(".opf"));
    expect(opf).toBeDefined();
    expect((await readZipEntry(path, opf!))?.toString("utf8")).toBe(OPF);
  });

  it("refuses an unsupported compression method", async () => {
    const path = await write(
      "bzip.epub",
      buildZip([{ name: "a.opf", content: OPF, method: 12 }]),
    );
    const [entry] = await listZipEntries(path);
    expect(entry.compressionMethod).toBe(12);
    expect(await readZipEntry(path, entry)).toBeNull();
  });

  it("refuses an encrypted entry", async () => {
    const path = await write(
      "encrypted.epub",
      buildZip([{ name: "a.opf", content: OPF }]),
    );
    const [entry] = await listZipEntries(path);
    expect(await readZipEntry(path, { ...entry, encrypted: true })).toBeNull();
  });

  it("returns null when the local header offset does not point at a header", async () => {
    const path = await write(
      "badlocal.epub",
      buildZip([{ name: "a.opf", content: OPF }]),
    );
    const [entry] = await listZipEntries(path);
    expect(
      await readZipEntry(path, { ...entry, localHeaderOffset: 7 }),
    ).toBeNull();
  });

  it("refuses an entry whose declared uncompressed size is implausible", async () => {
    const path = await write(
      "bigdeclared.epub",
      buildZip([{ name: "a.opf", content: OPF }]),
    );
    const [entry] = await listZipEntries(path);
    expect(
      await readZipEntry(path, {
        ...entry,
        uncompressedSize: 64 * 1024 * 1024,
      }),
    ).toBeNull();
  });

  it("refuses a zip bomb that understates its uncompressed size", async () => {
    // 32 MiB of zeros deflates to a few KB. The central directory is rewritten
    // to claim a harmless size, so only the capped inflate can stop this.
    const bomb = deflateRawSync(Buffer.alloc(32 * 1024 * 1024, 0));
    const name = Buffer.from("a.opf", "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(bomb.length, 18);
    local.writeUInt32LE(1024, 22); // lie: claims 1 KiB uncompressed
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(bomb.length, 20);
    central.writeUInt32LE(1024, 24); // same lie
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);

    const localBytes = Buffer.concat([local, name, bomb]);
    const centralBytes = Buffer.concat([central, name]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralBytes.length, 12);
    eocd.writeUInt32LE(localBytes.length, 16);

    const path = await write(
      "bomb.epub",
      Buffer.concat([localBytes, centralBytes, eocd]),
    );
    const [entry] = await listZipEntries(path);
    expect(entry.uncompressedSize).toBe(1024); // the lie passes the cheap check
    expect(await readZipEntry(path, entry)).toBeNull(); // the capped inflate refuses it
  });

  it("returns null instead of throwing on corrupt deflate data", async () => {
    const bytes = buildZip([{ name: "a.opf", content: OPF }]);
    // Overwrite the compressed payload, which starts after the 30-byte local
    // header plus the 5-byte name "a.opf".
    bytes.fill(0xff, 35, 45);
    const path = await write("corrupt.epub", bytes);
    const [entry] = await listZipEntries(path);
    expect(await readZipEntry(path, entry)).toBeNull();
  });
});

describe("readZipEntryText", () => {
  it("returns the first matching entry as text", async () => {
    const path = await write(
      "match.epub",
      buildZip([
        { name: "mimetype", content: "application/epub+zip", method: 0 },
        { name: "OEBPS/content.opf", content: OPF },
      ]),
    );
    const xml = await readZipEntryText(path, (n) =>
      n.toLowerCase().endsWith(".opf"),
    );
    expect(xml).toBe(OPF);
  });

  it("returns null when nothing matches", async () => {
    const path = await write(
      "nomatch.epub",
      buildZip([
        { name: "mimetype", content: "application/epub+zip", method: 0 },
      ]),
    );
    expect(await readZipEntryText(path, (n) => n.endsWith(".opf"))).toBeNull();
  });

  it("returns null for a non-zip file", async () => {
    const path = await write("garbage.epub", Buffer.from("nope"));
    expect(await readZipEntryText(path, () => true)).toBeNull();
  });
});
