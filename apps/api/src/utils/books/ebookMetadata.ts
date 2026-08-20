import { basename, extname } from "node:path";
import type { BookFormat } from "@rawkoon/shared/types";

/**
 * Lightweight ebook metadata extraction.
 *
 * MediaInfo is useless for ebooks, so nothing is forced through it. An epub is
 * a zip containing OPF XML, which carries title, author, language and ISBN
 * directly; mobi/azw3 expose a title in their header; pdf gets nothing beyond
 * its filename. Audiobooks take the other path entirely and reuse
 * mediainfoScanner, which handles audio containers properly.
 */

export interface EbookMetadata {
  title: string | null;
  authors: string[];
  language: string | null;
  isbn13: string | null;
}

const EMPTY: EbookMetadata = {
  title: null,
  authors: [],
  language: null,
  isbn13: null,
};

const FORMAT_BY_EXT: Record<string, BookFormat> = {
  ".epub": "epub",
  ".mobi": "mobi",
  ".azw3": "azw3",
  ".azw": "azw3",
  ".pdf": "pdf",
  ".cbz": "cbz",
  ".m4b": "m4b",
  ".m4a": "m4b",
  ".mp3": "mp3",
  ".flac": "flac",
  ".ogg": "ogg",
  ".opus": "ogg",
};

/** Map a path to a known book format, or null when it is not a book file. */
export function formatForPath(filePath: string): BookFormat | null {
  return FORMAT_BY_EXT[extname(filePath).toLowerCase()] ?? null;
}

const decodeXmlEntities = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

const tagText = (xml: string, tag: string): string[] => {
  const out: string[] = [];
  // Namespace-agnostic: OPF files use dc:title, sometimes plain title.
  const re = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`,
    "gi",
  );
  for (const m of xml.matchAll(re)) {
    const text = decodeXmlEntities(m[1].replace(/<[^>]*>/g, "")).trim();
    if (text) out.push(text);
  }
  return out;
};

const isbn13From = (xml: string): string | null => {
  for (const raw of tagText(xml, "identifier")) {
    const digits = raw.replace(/[^0-9Xx]/g, "");
    if (/^\d{13}$/.test(digits)) return digits;
  }
  return null;
};

/**
 * Read the OPF package document out of an epub.
 *
 * Bun's zip support is not exposed as an API, so this shells out to `unzip -p`
 * when available and degrades to filename-only metadata otherwise. Import must
 * never fail because metadata could not be read — the file is still the file.
 */
async function readEpubOpf(filePath: string): Promise<string | null> {
  try {
    const list = Bun.spawn(["unzip", "-Z1", filePath], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const listing = await new Response(list.stdout).text();
    if ((await list.exited) !== 0) return null;

    const opfPath = listing
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().endsWith(".opf"));
    if (!opfPath) return null;

    const cat = Bun.spawn(["unzip", "-p", filePath, opfPath], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const xml = await new Response(cat.stdout).text();
    if ((await cat.exited) !== 0) return null;
    return xml;
  } catch {
    return null;
  }
}

/**
 * Best-effort metadata for one ebook file. Never throws: a malformed or
 * unreadable file yields empty metadata and the import proceeds.
 */
export async function readEbookMetadata(
  filePath: string,
): Promise<EbookMetadata> {
  const format = formatForPath(filePath);
  if (!format) return EMPTY;

  if (format === "epub") {
    const xml = await readEpubOpf(filePath);
    if (!xml) return EMPTY;
    const titles = tagText(xml, "title");
    const creators = tagText(xml, "creator");
    const languages = tagText(xml, "language");
    return {
      title: titles[0] ?? null,
      authors: creators,
      language: languages[0]?.slice(0, 2).toLowerCase() ?? null,
      isbn13: isbn13From(xml),
    };
  }

  if (format === "mobi" || format === "azw3") {
    // The PalmDOC header stores the database name in the first 32 bytes. It is
    // truncated and sanitized, so it is a weak title hint and nothing more.
    try {
      const fh = Bun.file(filePath);
      const head = new Uint8Array(await fh.slice(0, 32).arrayBuffer());
      // Decoded byte-wise: the PalmDOC database name is a fixed 32-byte field
      // of single-byte chars, and Bun's TextDecoder has no "latin1".
      const name = Array.from(head)
        .map((b) => String.fromCharCode(b))
        .join("")
        .replace(/\0+$/, "")
        .replace(/[_]+/g, " ")
        .trim();
      return { ...EMPTY, title: name || null };
    } catch {
      return EMPTY;
    }
  }

  // pdf / cbz: nothing worth parsing for a first cut.
  return EMPTY;
}

/** Strip the extension for use as a fallback display name. */
export function fileNameWithoutExt(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}
