import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import {
  normalizeSeriesName,
  parseSeriesPosition,
} from "@rawkoon/api/utils/books/seriesName";
import { BookProviderUnavailableError, type AsinCandidate } from "./types";

/**
 * Audnexus has no book title search — GET /books/{asin} is ASIN-keyed only —
 * so ASINs come from Audible's own catalog API. This is the route
 * Audiobookshelf takes too.
 *
 * Verified live 2026-08-24: this response_groups set is the one that returns
 * contributors and series. Without it, narrators and series are simply absent
 * from the payload rather than empty, which reads as "this book has no
 * narrators".
 */
const RESPONSE_GROUPS =
  "product_desc,product_attrs,contributors,series,media,product_extended_attrs";

export const AUDIBLE_TLD_BY_REGION: Record<string, string> = {
  au: "com.au",
  br: "com.br",
  ca: "ca",
  de: "de",
  es: "es",
  fr: "fr",
  in: "in",
  it: "it",
  jp: "co.jp",
  uk: "co.uk",
  us: "com",
};

const CACHE_TTL_SEARCH = 3600; // 1h — same TTL the Google provider uses.
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * The catalog lists translators and other roles inside `authors`, annotated in
 * the name itself ("… - traducteur"). Google Books does the same, and the
 * book_authors trigger propagated a translator into LibraryBook.authors as a
 * result. Drop annotated entries here rather than downstream.
 */
const ROLE_ANNOTATION = /\s[-–—]\s*(traducteur|translator|adapt|illustrat)/iu;

const names = (v: unknown, dropRoles = false): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const entry of v) {
    if (!entry || typeof entry !== "object") continue;
    const name = str((entry as Record<string, unknown>).name);
    if (!name) continue;
    if (dropRoles && ROLE_ANNOTATION.test(name)) continue;
    out.push(name);
  }
  return out;
};

/** Keys are pixel widths as strings; the widest is the useful one. */
const coverFrom = (images: unknown): string | null => {
  if (!images || typeof images !== "object") return null;
  const map = images as Record<string, unknown>;
  const widths = Object.keys(map)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  for (const w of widths) {
    const url = str(map[String(w)]);
    if (url) return url;
  }
  return null;
};

export function mapAudibleProduct(raw: unknown): AsinCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const asin = str(p.asin);
  const title = str(p.title);
  if (!asin || !title) return null;

  const series = Array.isArray(p.series)
    ? (p.series[0] as Record<string, unknown> | undefined)
    : undefined;

  const runtime = p.runtime_length_min;

  return {
    asin,
    title,
    subtitle: str(p.subtitle),
    authors: names(p.authors, true),
    narrators: names(p.narrators),
    seriesName: normalizeSeriesName(str(series?.title)),
    seriesPosition: parseSeriesPosition(series?.sequence),
    language: str(p.language),
    runtimeMin: typeof runtime === "number" && runtime > 0 ? runtime : null,
    publisher: str(p.publisher_name),
    releaseDate: str(p.release_date),
    coverUrl: coverFrom(p.product_images),
    genres: [],
  };
}

export async function searchAudibleProducts(
  keywords: string,
  opts: { region: string; limit?: number },
): Promise<AsinCandidate[]> {
  const term = keywords.replace(/\s+/gu, " ").trim();
  if (!term) return [];
  const region = opts.region.trim().toLowerCase();
  const tld = AUDIBLE_TLD_BY_REGION[region];
  if (!tld) {
    throw new BookProviderUnavailableError(
      `Unsupported Audible region "${region}"`,
    );
  }
  const limit = Math.min(20, Math.max(1, opts.limit ?? 5));

  const cacheKey = `books:audible:search:${region}:${term.toLowerCase()}:${limit}`;
  const hit = await getJsonCache<AsinCandidate[]>(cacheKey);
  if (hit) return hit;

  const url = new URL(`https://api.audible.${tld}/1.0/catalog/products`);
  url.searchParams.set("keywords", term);
  url.searchParams.set("num_results", String(limit));
  url.searchParams.set("products_sort_by", "Relevance");
  url.searchParams.set("response_groups", RESPONSE_GROUPS);

  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as {
        products?: unknown;
      } | null;
      const raw = Array.isArray(body?.products) ? body.products : [];
      const mapped = raw
        .map(mapAudibleProduct)
        .filter((c): c is AsinCandidate => c !== null);
      // Cache successes only: caching an outage would make the book
      // unresolvable until the TTL expired.
      if (mapped.length > 0) {
        await setJsonCache(cacheKey, mapped, CACHE_TTL_SEARCH);
      }
      return mapped;
    }

    lastStatus = res?.status;
    // 4xx other than 429 is a permanent client error — no point retrying.
    if (res && res.status < 500 && res.status !== 429) {
      throw new BookProviderUnavailableError(
        `Audible rejected the request (HTTP ${res.status})`,
        res.status,
      );
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  throw new BookProviderUnavailableError(
    `Audible unavailable after ${MAX_ATTEMPTS} attempts` +
      (lastStatus ? ` (last status ${lastStatus})` : ""),
    lastStatus,
  );
}
