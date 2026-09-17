import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { BookProviderUnavailableError } from "@rawkoon/api/services/books/types";

/**
 * Scraper for the weekly Palmarès (Gaspard) bestseller lists on leslibraires.ca,
 * the Québec independent-bookstore co-op. It is the only free "most-sold
 * francophone books" signal available — Google Books has no popularity ranking
 * and the paid Gaspard/BTLF feed is membership-gated — so it backs the books
 * Explore "popular" shelf the way TMDB's trending endpoint backs movies/TV.
 *
 * The page has no public API, but it ships a schema.org `ItemList` in a
 * `<script type="application/ld+json">` block. That structured data is far more
 * stable than the visual DOM, so we parse it and nothing else: a CSS reskin
 * breaks the layout, not this. It yields rank + title + product URL (which
 * carries the ISBN-13); author/genre/overview are intentionally left to the
 * existing provider chain via `resolveIsbn`, so this file stays a pure ranking
 * source and never duplicates metadata mapping.
 */

const BASE_URL = "https://www.leslibraires.ca/theme";

/**
 * A descriptive User-Agent — this scrapes a small co-op's site, so identify the
 * client honestly rather than spoofing a browser.
 */
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Product URLs carry the ISBN-13 as the last path token: `…-<isbn13>`, then a
 * `.html` suffix, a `?utm…` query, or nothing. Match 13 digits after a hyphen
 * not followed by a further digit, so every suffix form is covered.
 */
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

/**
 * Pull every `application/ld+json` block out of the page and return the first
 * that is an `ItemList`. Malformed blocks are skipped, not fatal — the page
 * also embeds a `LocalBusiness` block that must be ignored.
 */
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

/**
 * Parse a palmarès page's HTML into ranked entries. Exported and pure so the
 * fragile bits — JSON-LD extraction and the ISBN-suffix parsing — are tested
 * against a saved fixture without a network round-trip.
 */
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
    });
  }
  entries.sort((a, b) => a.rank - b.rank);
  return entries;
}

/**
 * Fetch the raw HTML with retry on 5xx/network failure. Throws
 * BookProviderUnavailableError so callers can tell "the site is down" from "the
 * list is empty" — and so the caller never caches a transient failure.
 */
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

/**
 * The weekly bestseller list for one palmarès theme, cached for half a day.
 * A successful-but-empty parse is not cached — an empty result usually means the
 * page markup shifted, and caching it would hide the shelf for the whole TTL.
 */
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
  if (entries.length > 0) await setJsonCache(cacheKey, entries, CACHE_TTL);
  return entries;
}
