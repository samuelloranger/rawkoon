import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { BookProviderUnavailableError } from "@rawkoon/api/services/books/types";

/** Scrapes the weekly Palmarès bestseller lists from leslibraires.ca via the schema.org `ItemList` JSON-LD (more stable than the DOM); other metadata is left to `resolveIsbn`. */

const BASE_URL = "https://www.leslibraires.ca/theme";

/** Descriptive User-Agent: this scrapes a small co-op's site, so don't spoof a browser. */
const USER_AGENT =
  "Rawkoon/1.x (self-hosted media library; +https://github.com/samuelloranger/rawkoon)";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

/** The palmarès is published weekly, so a half-day cache is generous. */
const CACHE_TTL = 12 * 60 * 60;

/** The palmarès variants leslibraires exposes as `/theme/<slug>` pages. */
export const PALMARES_THEMES = {
  general: "palmares",
  jeunesse: "palmares-jeunesse",
} as const;

export type PalmaresTheme = keyof typeof PALMARES_THEMES;

export type PalmaresCoverSize = "small" | "medium";

export interface PalmaresEntry {
  /** 1-based position in the bestseller list. */
  rank: number;
  title: string;
  /** ISBN-13, parsed from the product URL — the join key for enrichment. */
  isbn13: string;
  /** Canonical product page (query string stripped). */
  url: string;
  /** Cover image on leslibraires' CDN; null when the ISBN is missing. */
  coverUrl: string | null;
  /** Scraped from the product page: leslibraires covers francophone-Québec titles Google Books lacks. */
  author: string | null;
  overview: string | null;
  publishedYear: number | null;
}

/** How many product pages to scrape at once — polite to a small co-op's site. */
const DETAIL_CONCURRENCY = 5;
const DETAIL_CACHE_TTL = 24 * 60 * 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Product URLs end in `-<isbn13>` then `.html`, a `?utm…` query or nothing; match 13 digits not followed by a digit. */
const isbnFromUrl = (url: string): string | null => {
  const match = url.match(/-(\d{13})(?!\d)/);
  return match ? match[1] : null;
};

/** leslibraires' CDN layout, verified against live covers. */
export const palmaresCoverUrl = (
  isbn13: string,
  size: PalmaresCoverSize = "medium",
): string =>
  `https://images.leslibraires.ca/books/${isbn13}/front/${isbn13}_${size}.webp`;

interface JsonLdListItem {
  "@type"?: string;
  position?: number;
  name?: string;
  url?: string;
}

interface JsonLdItemList {
  "@type"?: string;
  itemListElement?: JsonLdListItem[];
}

/** First `ItemList` JSON-LD block; malformed blocks are skipped and the `LocalBusiness` block ignored. */
function extractItemList(html: string): JsonLdItemList | null {
  const blocks = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, raw] of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as JsonLdItemList)["@type"] === "ItemList"
    ) {
      return parsed as JsonLdItemList;
    }
  }
  return null;
}

/** Pure and exported so JSON-LD extraction and ISBN parsing are testable against a fixture. */
export function parsePalmaresHtml(html: string): PalmaresEntry[] {
  const list = extractItemList(html);
  if (!list?.itemListElement) return [];

  const entries: PalmaresEntry[] = [];
  const seenIsbns = new Set<string>();
  for (const item of list.itemListElement) {
    const rawUrl = item.url?.trim();
    const title = item.name?.trim();
    if (!rawUrl || !title) continue;

    const isbn13 = isbnFromUrl(rawUrl);
    if (!isbn13 || seenIsbns.has(isbn13)) continue;
    seenIsbns.add(isbn13);

    // Strip tracking query params so the stored URL is the canonical page.
    const url = rawUrl.split("?")[0];
    entries.push({
      rank:
        typeof item.position === "number" ? item.position : entries.length + 1,
      title,
      isbn13,
      url,
      coverUrl: palmaresCoverUrl(isbn13),
      author: null,
      overview: null,
      publishedYear: null,
    });
  }
  entries.sort((a, b) => a.rank - b.rank);
  return entries;
}

export interface PalmaresProductDetails {
  author: string | null;
  overview: string | null;
  coverUrl: string | null;
  publishedYear: number | null;
}

/** Parse the `Product`/`Book` JSON-LD block on a product page. */
export function parseProductDetails(html: string): PalmaresProductDetails {
  const empty: PalmaresProductDetails = {
    author: null,
    overview: null,
    coverUrl: null,
    publishedYear: null,
  };
  const blocks = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, raw] of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const node = parsed as Record<string, unknown>;
    const type = node["@type"];
    const isBook = Array.isArray(type)
      ? type.includes("Book")
      : type === "Book";
    if (!isBook) continue;

    // author: a Person object, an array of them, or a bare string.
    let author: string | null = null;
    const a = node.author;
    const first = Array.isArray(a) ? a[0] : a;
    if (typeof first === "string") author = first.trim() || null;
    else if (first && typeof first === "object") {
      const name = (first as Record<string, unknown>).name;
      if (typeof name === "string") author = name.trim() || null;
    }

    const description =
      typeof node.description === "string" ? node.description.trim() : "";
    const image = Array.isArray(node.image) ? node.image[0] : node.image;
    const coverUrl = typeof image === "string" && image ? image : null;
    const date =
      typeof node.datePublished === "string" ? node.datePublished : "";
    const yearMatch = date.match(/^(\d{4})/);
    const publishedYear = yearMatch ? Number(yearMatch[1]) : null;

    return {
      author,
      overview: description || null,
      coverUrl,
      publishedYear,
    };
  }
  return empty;
}

/** Fetch and parse one product page, cached per ISBN. Failures degrade to null. */
async function fetchProductDetails(
  entry: PalmaresEntry,
): Promise<PalmaresProductDetails | null> {
  const cacheKey = `books:palmares:detail:${entry.isbn13}`;
  const cached = await getJsonCache<PalmaresProductDetails>(cacheKey);
  if (cached) return cached;
  const res = await fetch(entry.url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) return null;
  const details = parseProductDetails(await res.text());
  await setJsonCache(cacheKey, details, DETAIL_CACHE_TTL);
  return details;
}

/** Fill author/overview/cover/year on each entry from its product page. */
async function enrichFromProductPages(entries: PalmaresEntry[]): Promise<void> {
  const worker = async (start: number) => {
    for (let i = start; i < entries.length; i += DETAIL_CONCURRENCY) {
      const entry = entries[i];
      const details = await fetchProductDetails(entry).catch(() => null);
      if (!details) continue;
      entry.author = details.author ?? entry.author;
      entry.overview = details.overview ?? entry.overview;
      entry.publishedYear = details.publishedYear ?? entry.publishedYear;
      // Prefer the page's own cover: some titles have none at the guessed CDN size.
      entry.coverUrl = details.coverUrl ?? entry.coverUrl;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(DETAIL_CONCURRENCY, entries.length) },
      (_, k) => worker(k),
    ),
  );
}

/** Fetch HTML with retry; throws BookProviderUnavailableError so a transient failure isn't mistaken for an empty list or cached. */
async function fetchPalmaresHtml(theme: PalmaresTheme): Promise<string> {
  const slug = PALMARES_THEMES[theme];
  const url = `${BASE_URL}/${slug}`;

  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => null);

    if (res?.ok) return res.text();

    lastStatus = res?.status;
    // 4xx other than 429 is permanent — a renamed slug won't fix itself.
    if (res && res.status < 500 && res.status !== 429) {
      throw new BookProviderUnavailableError(
        `leslibraires rejected the request (HTTP ${res.status})`,
        res.status,
      );
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  throw new BookProviderUnavailableError(
    `leslibraires unavailable after ${MAX_ATTEMPTS} attempts` +
      (lastStatus ? ` (last status ${lastStatus})` : ""),
    lastStatus,
  );
}

/** Weekly list for one theme, cached half a day; an empty parse isn't cached since it usually means the markup shifted. */
export async function getPalmares(
  theme: PalmaresTheme = "general",
  opts: { skipCache?: boolean } = {},
): Promise<PalmaresEntry[]> {
  const cacheKey = `books:palmares:${theme}`;
  if (!opts.skipCache) {
    const cached = await getJsonCache<PalmaresEntry[]>(cacheKey);
    if (cached) return cached;
  }

  const html = await fetchPalmaresHtml(theme);
  const entries = parsePalmaresHtml(html);
  if (entries.length > 0) {
    await enrichFromProductPages(entries);
    await setJsonCache(cacheKey, entries, CACHE_TTL);
  }
  return entries;
}
