import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { normalizeTitleForMatch } from "@rawkoon/api/utils/medias/filenameParser";
import {
  BookProviderUnavailableError,
  type BookMatchInput,
  type BookMetadataProvider,
  type ProviderFields,
} from "./types";

/**
 * Open Library, ranked last deliberately.
 *
 * Verified live 2026-08-24 against a French-language library:
 *  - /isbn/{isbn}.json returned an HTML 404 page for every French ISBN tried,
 *    so that route is not used here at all.
 *  - /search.json did find the work, but with no series, no language, and a
 *    different printing's ISBN than the library's copy.
 *
 * It therefore contributes page count, ratings and first-publish year, and
 * nothing else. It must never claim series, language, isbn13 or a cover — a
 * weak source asserting those would overwrite better data wherever it
 * outranked another source.
 */

const SEARCH_URL = "https://openlibrary.org/search.json";
const FIELDS =
  "key,title,author_name,first_publish_year,number_of_pages_median,ratings_average,ratings_count";
const CACHE_TTL = 86_400; // 24h

/**
 * Author-name tokens for overlap comparison. Mirrors the ASIN resolver: two
 * letters or fewer is an initial or a particle and matches everything.
 */
const authorTokens = (names: string[]): Set<string> => {
  const out = new Set<string>();
  for (const name of names) {
    for (const tok of normalizeTitleForMatch(name).split(" ")) {
      if (tok.length > 2) out.add(tok);
    }
  }
  return out;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A JSON route that answers with HTML is a 404 in disguise, not an outage. */
export function isHtmlBody(text: string): boolean {
  return /^\s*<(?:!doctype|html)/iu.test(text);
}

/**
 * Choose the doc that is really this book, or nothing.
 *
 * Requires BOTH an exact normalized title and an overlapping author token.
 * Open Library's relevance ranking is loose, and a title alone is not an
 * identifier — different authors publish under the same title, and this
 * provider has no volume-number defences of its own to catch the mistake
 * afterwards. Attaching another author's page count and rating is worse than
 * contributing nothing.
 */
export function pickOpenLibraryDoc(
  docs: unknown[],
  title: string,
  authors: string[],
): unknown | null {
  const wantedTitle = normalizeTitleForMatch(title);
  if (!wantedTitle) return null;
  const wantedAuthors = authorTokens(authors);

  for (const d of docs) {
    if (!d || typeof d !== "object") continue;
    const row = d as Record<string, unknown>;
    const t = row.title;
    if (typeof t !== "string" || normalizeTitleForMatch(t) !== wantedTitle) {
      continue;
    }
    // With no author on our side there is nothing to verify against, so the
    // title match has to stand on its own.
    if (wantedAuthors.size === 0) return d;
    const names = Array.isArray(row.author_name)
      ? row.author_name.filter((n): n is string => typeof n === "string")
      : [];
    const found = authorTokens(names);
    for (const tok of wantedAuthors) if (found.has(tok)) return d;
  }
  return null;
}

export function mapOpenLibraryDoc(raw: unknown): ProviderFields {
  if (!raw || typeof raw !== "object") return {};
  const d = raw as Record<string, unknown>;
  const fields: ProviderFields = {};
  const pages = num(d.number_of_pages_median);
  if (pages !== null) fields.pageCount = pages;
  const rating = num(d.ratings_average);
  if (rating !== null) fields.rating = rating;
  const ratingCount = num(d.ratings_count);
  if (ratingCount !== null) fields.ratingCount = ratingCount;
  const year = num(d.first_publish_year);
  if (year !== null) fields.publishedYear = year;
  return fields;
}

async function fetchOpenLibrary(url: string): Promise<unknown | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "rawkoon" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res) throw new BookProviderUnavailableError("Open Library unreachable");
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) {
      throw new BookProviderUnavailableError(
        `Open Library unavailable (HTTP ${res.status})`,
        res.status,
      );
    }
    return null;
  }
  const text = await res.text();
  // An HTML body on a .json route means "no record", not "server broken".
  if (isHtmlBody(text)) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

class OpenLibraryProvider implements BookMetadataProvider {
  readonly source = "openlibrary" as const;

  async enrich(book: BookMatchInput): Promise<ProviderFields> {
    const query = `${book.title} ${book.authors.join(" ")}`.trim();
    if (!query) return {};

    const cacheKey = `books:ol:search:${normalizeTitleForMatch(query)}`;
    const cached = await getJsonCache<ProviderFields>(cacheKey);
    if (cached) return cached;

    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("fields", FIELDS);
    url.searchParams.set("limit", "3");

    const body = (await fetchOpenLibrary(url.toString())) as {
      docs?: unknown;
    } | null;
    const docs = Array.isArray(body?.docs) ? body.docs : [];
    if (docs.length === 0) return {};

    const doc = pickOpenLibraryDoc(docs, book.title, book.authors);
    if (!doc) return {};

    const fields = mapOpenLibraryDoc(doc);
    if (Object.keys(fields).length > 0) {
      await setJsonCache(cacheKey, fields, CACHE_TTL);
    }
    return fields;
  }
}

export function getOpenLibraryProvider(): BookMetadataProvider {
  return new OpenLibraryProvider();
}
