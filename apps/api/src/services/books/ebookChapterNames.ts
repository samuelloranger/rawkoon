import { posix } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { htmlToText } from "@rawkoon/api/services/books/handoff/epubTextModel";
import { parseOpfMetadata } from "@rawkoon/api/utils/books/ebookMetadata";
import {
  listZipEntries,
  readZipEntry,
  type ZipEntry,
} from "@rawkoon/api/utils/books/zipReader";

export interface TocEntry {
  title: string;
  words: number;
}

// Narration time tracks text length closely, so a real match correlates near 1.
const MIN_CORRELATION = 0.9;
// The winning offset must clearly beat the runner-up, or the match is a guess.
const MIN_MARGIN = 0.2;
// Front and back matter (author's note, acknowledgements) is often not narrated.
const MAX_UNNARRATED_ENTRIES = 5;

const CHAPTER_WORD: Record<string, string> = {
  fr: "Chapitre",
  es: "Capítulo",
  it: "Capitolo",
  de: "Kapitel",
  pt: "Capítulo",
  nl: "Hoofdstuk",
};

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    varA += da * da;
    varB += db * db;
  }
  const den = Math.sqrt(varA * varB);
  return den === 0 ? Number.NaN : num / den;
}

/** Picks the TOC window whose word counts track the file durations; null when no window is convincing. */
export function alignTocToDurations(
  durations: number[],
  toc: TocEntry[],
): string[] | null {
  const n = durations.length;
  const spare = toc.length - n;
  if (n < 3 || spare < 0 || spare > MAX_UNNARRATED_ENTRIES) return null;

  let best = Number.NEGATIVE_INFINITY;
  let runnerUp = Number.NEGATIVE_INFINITY;
  let bestOffset = -1;
  for (let offset = 0; offset <= spare; offset++) {
    const words = toc.slice(offset, offset + n).map((e) => e.words);
    const r = pearson(durations, words);
    if (Number.isNaN(r)) continue;
    if (r > best) {
      runnerUp = best;
      best = r;
      bestOffset = offset;
    } else if (r > runnerUp) {
      runnerUp = r;
    }
  }
  if (bestOffset < 0 || best < MIN_CORRELATION) return null;
  if (spare > 0 && best - runnerUp < MIN_MARGIN) return null;
  return toc.slice(bestOffset, bestOffset + n).map((e) => e.title);
}

/** A bare "12" label reads as "Chapitre 12" in the ebook's language. */
export function chapterLabel(title: string, language: string | null): string {
  if (!/^\d+$/.test(title)) return title;
  return `${CHAPTER_WORD[language ?? ""] ?? "Chapter"} ${Number(title)}`;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(
    tag,
  );
  return m ? (m[1] ?? m[2] ?? null) : null;
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const resolveHref = (dir: string, href: string): string => {
  const path = safeDecode(href.split("#")[0] ?? href);
  return posix.normalize(dir === "." ? path : posix.join(dir, path));
};

/** TOC labels and their target documents, in reading order (EPUB 3 nav or EPUB 2 NCX). */
export function parseTocLinks(
  xml: string,
  isNav: boolean,
): { title: string; href: string }[] {
  const links: { title: string; href: string }[] = [];
  if (isNav) {
    const nav =
      /<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i.exec(
        xml,
      )?.[1] ?? "";
    for (const m of nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(m[1] ?? "", "href");
      if (href) links.push({ title: htmlToText(m[2] ?? ""), href });
    }
  } else {
    const navPoint =
      /<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\b([^>]*)>/gi;
    for (const m of xml.matchAll(navPoint)) {
      const href = attr(m[2] ?? "", "src");
      if (href) links.push({ title: htmlToText(m[1] ?? ""), href });
    }
  }
  return links.filter((l) => l.title);
}

async function readText(
  path: string,
  entries: Map<string, ZipEntry>,
  name: string,
): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) return null;
  const bytes = await readZipEntry(path, entry);
  return bytes ? bytes.toString("utf8") : null;
}

/** TOC entries with the word count of the spine documents each one spans; null when entries share a document. */
export async function readEpubToc(
  path: string,
): Promise<{ entries: TocEntry[]; language: string | null } | null> {
  const entries = new Map((await listZipEntries(path)).map((e) => [e.name, e]));
  const container = await readText(path, entries, "META-INF/container.xml");
  const rootTag = container?.match(/<rootfile\b[^>]*>/i)?.[0];
  const opfPath = rootTag ? attr(rootTag, "full-path") : null;
  if (!opfPath) return null;
  const opf = await readText(path, entries, opfPath);
  if (!opf) return null;
  const opfDir = posix.dirname(opfPath);

  const manifest = new Map<string, { href: string; tag: string }>();
  for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id && href) manifest.set(id, { href, tag });
  }
  const items = [...manifest.values()];
  const navItem = items.find((i) =>
    /\bnav\b/.test(attr(i.tag, "properties") ?? ""),
  );
  const ncxItem = items.find(
    (i) => attr(i.tag, "media-type") === "application/x-dtbncx+xml",
  );
  const tocItem = navItem ?? ncxItem;
  if (!tocItem) return null;
  const tocPath = resolveHref(opfDir, tocItem.href);
  const tocXml = await readText(path, entries, tocPath);
  if (!tocXml) return null;
  const links = parseTocLinks(tocXml, tocItem === navItem);

  const spine: string[] = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) ?? []) {
    const item = manifest.get(attr(tag, "idref") ?? "");
    if (item) spine.push(resolveHref(opfDir, item.href));
  }

  const tocDir = posix.dirname(tocPath);
  const starts = links.map((l) => spine.indexOf(resolveHref(tocDir, l.href)));
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! < 0 || (i > 0 && starts[i]! <= starts[i - 1]!)) return null;
  }

  const wordsOf = async (name: string): Promise<number> => {
    const html = await readText(path, entries, name);
    return html ? htmlToText(html).split(" ").filter(Boolean).length : 0;
  };
  const docWords = await Promise.all(spine.map(wordsOf));
  const tocEntries = links.map((link, i) => {
    const end = starts[i + 1] ?? spine.length;
    let words = 0;
    for (let d = starts[i]!; d < end; d++) words += docWords[d]!;
    return { title: link.title, words };
  });
  return { entries: tocEntries, language: parseOpfMetadata(opf).language };
}

/** Chapter titles for an audiobook edition, read from the same book's epub; null when there is no convincing match. */
export async function ebookChapterNames(
  audiobookEditionId: number,
  durations: number[],
): Promise<string[] | null> {
  try {
    const audiobook = await prisma.bookEdition.findUnique({
      where: { id: audiobookEditionId },
      select: { bookId: true },
    });
    if (!audiobook) return null;
    const ebook = await prisma.bookEdition.findUnique({
      where: { bookId_kind: { bookId: audiobook.bookId, kind: "ebook" } },
      select: { files: { select: { filePath: true, format: true } } },
    });
    const epub = ebook?.files.find((f) => f.format.toLowerCase() === "epub");
    if (!epub) return null;

    const toc = await readEpubToc(epub.filePath);
    if (!toc) return null;
    const titles = alignTocToDurations(durations, toc.entries);
    return titles?.map((t) => chapterLabel(t, toc.language)) ?? null;
  } catch (e) {
    // Naming is cosmetic: an unreadable epub must not block chapter registration.
    console.warn(`[ebookChapterNames] edition ${audiobookEditionId}:`, e);
    return null;
  }
}
