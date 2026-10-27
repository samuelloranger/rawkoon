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
// A handful of lengths correlates by chance; fewer files can't prove a match.
const MIN_FILES = 4;
// Narration runs about 2-3.5 words a second; outside this band the lengths only correlate by shape.
const MIN_WORDS_PER_SEC = 1.5;
const MAX_WORDS_PER_SEC = 5;
// More entries than any real book has; reading their documents would only cost memory.
const MAX_TOC_ENTRIES = 2000;

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
  if (n < MIN_FILES || spare < 0 || spare > MAX_UNNARRATED_ENTRIES) return null;
  const totalSecs = durations.reduce((sum, d) => sum + d, 0);

  let best = Number.NEGATIVE_INFINITY;
  let runnerUp = Number.NEGATIVE_INFINITY;
  let bestOffset = -1;
  for (let offset = 0; offset <= spare; offset++) {
    const words = toc.slice(offset, offset + n).map((e) => e.words);
    const pace = words.reduce((sum, w) => sum + w, 0) / totalSecs;
    if (!(pace >= MIN_WORDS_PER_SEC && pace <= MAX_WORDS_PER_SEC)) continue;
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

const TOC_NAV =
  /\bepub:type\s*=\s*["'][^"']*\btoc\b[^"']*["']|\brole\s*=\s*["']doc-toc["']/i;

/** TOC labels and their target documents, in reading order (EPUB 3 nav or EPUB 2 NCX); [] when an entry can't be read. */
export function parseTocLinks(
  xml: string,
  isNav: boolean,
): { title: string; href: string }[] {
  const links: { title: string; href: string }[] = [];
  if (isNav) {
    const nav = [...xml.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)].find(
      (m) => TOC_NAV.test(m[1] ?? ""),
    )?.[2];
    for (const m of (nav ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(m[1] ?? "", "href");
      const title = htmlToText(m[2] ?? "");
      if (!href || !title) return [];
      links.push({ title, href });
    }
    return links;
  }
  // One chunk per navPoint, nested or not; prefixed and attributed tags are fine.
  for (const point of xml.split(/<(?:\w+:)?navPoint\b/i).slice(1)) {
    const label = /<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/i.exec(
      point,
    )?.[1];
    const content = /<(?:\w+:)?content\b([^>]*)>/i.exec(point)?.[1];
    const href = content ? attr(content, "src") : null;
    const title = label ? htmlToText(label) : "";
    // A skipped entry would leave a hole that a wrong alignment could slip through.
    if (!href || !title) return [];
    links.push({ title, href });
  }
  return links;
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

/**
 * TOC entries with the word count of the spine documents each one spans.
 * Null when the TOC can't cover `fileCount` files, or when two entries share a
 * document (sectioned books whose part and first chapter open the same file).
 */
export async function readEpubToc(
  path: string,
  fileCount?: number,
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

  let links: { title: string; href: string }[] = [];
  let tocPath = "";
  // A nav without a usable toc falls back to the NCX many EPUB 3 files still ship.
  for (const item of [navItem, ncxItem]) {
    if (!item || links.length > 0) continue;
    tocPath = resolveHref(opfDir, item.href);
    const xml = await readText(path, entries, tocPath);
    if (xml) links = parseTocLinks(xml, item === navItem);
  }
  if (links.length === 0 || links.length > MAX_TOC_ENTRIES) return null;
  if (
    fileCount !== undefined &&
    (links.length < fileCount ||
      links.length > fileCount + MAX_UNNARRATED_ENTRIES)
  ) {
    return null;
  }

  const spine: string[] = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) ?? []) {
    const item = manifest.get(attr(tag, "idref") ?? "");
    if (item) spine.push(resolveHref(opfDir, item.href));
  }
  if (new Set(spine).size !== spine.length) return null;

  const tocDir = posix.dirname(tocPath);
  const starts = links.map((l) => spine.indexOf(resolveHref(tocDir, l.href)));
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! < 0 || (i > 0 && starts[i]! <= starts[i - 1]!)) return null;
  }

  // One document at a time, and only from the first entry on.
  const docWords: number[] = [];
  for (let d = starts[0]!; d < spine.length; d++) {
    const html = await readText(path, entries, spine[d]!);
    docWords[d] = html ? htmlToText(html).split(" ").filter(Boolean).length : 0;
  }
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

    const toc = await readEpubToc(epub.filePath, durations.length);
    if (!toc) return null;
    const titles = alignTocToDurations(durations, toc.entries);
    return titles?.map((t) => chapterLabel(t, toc.language)) ?? null;
  } catch (e) {
    // Naming is cosmetic: an unreadable epub must not block chapter registration.
    console.warn(`[ebookChapterNames] edition ${audiobookEditionId}:`, e);
    return null;
  }
}
