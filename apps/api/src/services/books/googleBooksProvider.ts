import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeGoogleBooksConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { prisma } from "@rawkoon/api/db";
import {
  languageFromIsbn13,
  reconcileBookLanguage,
  sanitizeProviderHtml,
} from "@rawkoon/shared/utils";
import {
  BookProviderUnavailableError,
  type BookMatchInput,
  type BookIdentityProvider,
  type ProviderBook,
  type ProviderFields,
} from "./types";

const API_BASE = "https://www.googleapis.com/books/v1/volumes";

const CACHE_TTL_SEARCH = 3600; // 1h
const CACHE_TTL_VOLUME = 86_400; // 24h

/**
 * How many sibling editions to pull for an ISBN lookup.
 *
 * Google's `isbn:` query returns related printings of the same work, not a
 * strict identifier match. Taking the first hit with maxResults=1 is what
 * mapped a French Lumen ISBN onto the English Tor volume. Ten is enough to
 * cover the usual English + translation cluster without wasting quota.
 */
const ISBN_LOOKUP_LIMIT = 10;

/**
 * Every rule below came out of testing this API live against a French-language
 * title on 2026-08-20:
 *
 *  - Quoted phrase queries return HTTP 503. Unquoted ones return 200.
 *  - `isbn:` and `inauthor:` are precise; loose free text returned 300 hits
 *    with a university staff directory outranking the actual book.
 *  - HTTP 503 `backendFailed` is nondeterministic — the same URL failed three
 *    times and then succeeded — so retry, and never cache the failure.
 *  - Records are sparse: pageCount 0, empty description, null categories and
 *    null seriesInfo all occur on real volumes. Only title, authors and
 *    language can be relied on.
 *  - An `isbn:` query for a French edition still ranks the English original
 *    first. Prefer the volume that carries the queried ISBN; fall back to the
 *    registration-group language when no exact identifier match exists.
 */

const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 250;

/** Google chokes on quoted phrases, so strip quotes rather than pass them on. */
const sanitizeTerm = (raw: string): string =>
  raw.replace(/["""]/g, " ").replace(/\s+/g, " ").trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GoogleVolume = {
  id?: unknown;
  volumeInfo?: {
    title?: unknown;
    subtitle?: unknown;
    authors?: unknown;
    language?: unknown;
    publishedDate?: unknown;
    description?: unknown;
    industryIdentifiers?: unknown;
    imageLinks?: { thumbnail?: unknown; smallThumbnail?: unknown };
    seriesInfo?: {
      bookDisplayNumber?: unknown;
      volumeSeries?: unknown;
    };
  };
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const yearFrom = (v: unknown): number | null => {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
};

const isbn13From = (v: unknown): string | null => {
  if (!Array.isArray(v)) return null;
  for (const entry of v) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.type === "ISBN_13") return str(e.identifier);
  }
  return null;
};

/** Digits only; drops hyphens and spaces. */
export const isbnDigits = (raw: string): string => raw.replace(/[\s-]/g, "");

/**
 * Canonical ISBN-13 for an ISBN of either length, or null when the input is
 * not an ISBN at all.
 *
 * Everything downstream compares and stores 13 digits: `industryIdentifiers`
 * exposes ISBN_13, and only an ISBN-13 has a registration group to read a
 * language from. Without this conversion a 10-digit identifier can never match
 * a volume exactly and never resolves a language, so it silently fell through
 * to whatever Google ranked first.
 */
export function toIsbn13(raw: string): string | null {
  const digits = isbnDigits(raw);
  if (/^\d{13}$/.test(digits)) return digits;
  if (!/^\d{9}[\dXx]$/.test(digits)) return null;
  const core = `978${digits.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${core}${(10 - (sum % 10)) % 10}`;
}

/**
 * Pick the Google Books hit that actually is the edition the operator asked
 * for.
 *
 * Order of preference:
 *  1. Exact isbn13 match (the operator's identifier is on that volume).
 *  2. Language matching the ISBN registration group (978-2 → fr, …).
 *  3. First mapped hit — last resort when Google returns nothing usable.
 *
 * `strict` stops at tier 1. Tiers 2 and 3 are guesses, which is acceptable
 * when the answer is one search result among many but not when it decides a
 * book's identity: a rebind rewrites volumeId, title and language, and
 * pinQueriedIsbn then stamps the queried ISBN on the guess, hiding the
 * mismatch that would otherwise be visible.
 */
export function pickBookForIsbn(
  books: ProviderBook[],
  queriedIsbn: string,
  opts?: { strict?: boolean },
): ProviderBook | null {
  if (books.length === 0) return null;
  const digits = toIsbn13(queriedIsbn);
  if (!digits) return null;

  const exact = books.find(
    (b) => b.isbn13 != null && toIsbn13(b.isbn13) === digits,
  );
  if (exact) return exact;
  if (opts?.strict) return null;

  const wantedLang = languageFromIsbn13(digits);
  if (wantedLang) {
    const byLang = books.find((b) => b.language === wantedLang);
    if (byLang) return byLang;
  }

  return books[0] ?? null;
}

/**
 * Force the operator's ISBN onto the chosen volume.
 *
 * Google may attach a sibling edition's ISBN_13 as the "primary" identifier,
 * or the language field may disagree with the registration group. After an
 * ISBN search the typed identifier is the source of truth for both.
 */
export function pinQueriedIsbn(
  book: ProviderBook,
  queriedIsbn: string,
): ProviderBook {
  const digits = toIsbn13(queriedIsbn);
  if (!digits) return book;
  const { language } = reconcileBookLanguage(book.language, digits);
  return { ...book, isbn13: digits, language };
}

/**
 * Google returns only `smallThumbnail` and `thumbnail`, both far too small for
 * a library grid. The content endpoint renders the same cover larger, so
 * prefer it and keep the thumbnail as a fallback.
 */
const coverFrom = (volumeId: string, links: unknown): string | null => {
  if (volumeId) {
    return `https://books.google.com/books/content?id=${encodeURIComponent(
      volumeId,
    )}&printsec=frontcover&img=1&zoom=3`;
  }
  if (!links || typeof links !== "object") return null;
  const l = links as Record<string, unknown>;
  return str(l.thumbnail) ?? str(l.smallThumbnail);
};

const mapVolume = (raw: GoogleVolume): ProviderBook | null => {
  const volumeId = str(raw.id);
  const info = raw.volumeInfo;
  if (!volumeId || !info) return null;
  const title = str(info.title);
  if (!title) return null;

  const authors = Array.isArray(info.authors)
    ? info.authors.filter(
        (a): a is string => typeof a === "string" && !!a.trim(),
      )
    : [];

  const series = info.seriesInfo;
  let seriesName: string | null = null;
  let seriesPosition: number | null = null;
  if (series) {
    const display = str(series.bookDisplayNumber);
    if (display) {
      const n = Number(display);
      if (Number.isFinite(n)) seriesPosition = n;
    }
    if (Array.isArray(series.volumeSeries) && series.volumeSeries.length > 0) {
      const first = series.volumeSeries[0] as Record<string, unknown>;
      seriesName = str(first?.seriesId);
    }
  }

  const isbn13 = isbn13From(info.industryIdentifiers);
  // Google's `language` is unreliable — a French volume with a French
  // publisher, description and ISBN came back as Arabic. Cross-check it
  // against the ISBN registration group and prefer that when they disagree.
  const { language, correctedFrom } = reconcileBookLanguage(
    str(info.language),
    isbn13,
  );
  if (correctedFrom) {
    console.warn(
      `[googleBooks] volume ${volumeId} reported language "${correctedFrom}" but its ISBN ${isbn13} is a ${language} registration group — using ${language}`,
    );
  }

  return {
    volumeId,
    title,
    subtitle: str(info.subtitle),
    authors,
    language,
    publishedYear: yearFrom(info.publishedDate),
    isbn13,
    coverUrl: coverFrom(volumeId, info.imageLinks),
    // Descriptions arrive as markup. Sanitized on ingest so the database only
    // ever holds clean HTML; the renderer sanitizes again, which covers rows
    // stored before this existed.
    overview: sanitizeProviderHtml(str(info.description)) || null,
    seriesName,
    seriesPosition,
  };
};

async function loadConfig(): Promise<{ apiKey: string } | null> {
  const row = await getIntegrationConfigRecord("googlebooks");
  if (!row?.enabled) return null;
  const cfg = normalizeGoogleBooksConfig(row.config);
  return cfg ? { apiKey: cfg.api_key } : null;
}

/** Country is required for some regions; derive it from app settings. */
async function loadCountry(): Promise<string> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: 1 },
      select: { countryCode: true },
    });
    return row?.countryCode || "US";
  } catch {
    return "US";
  }
}

/**
 * Fetch with retry on 5xx. Throws BookProviderUnavailableError when the
 * provider errored, so callers can tell "unavailable" from "no results" —
 * never conflate the two, and never cache the former.
 */
async function fetchVolumes(
  query: string,
  apiKey: string,
  country: string,
  limit: number,
  langRestrict?: string,
): Promise<GoogleVolume[]> {
  const url = new URL(API_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("country", country);
  url.searchParams.set("maxResults", String(Math.min(40, Math.max(1, limit))));
  if (langRestrict) url.searchParams.set("langRestrict", langRestrict);
  url.searchParams.set("key", apiKey);

  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as {
        items?: unknown;
      } | null;
      if (!body) return [];
      return Array.isArray(body.items) ? (body.items as GoogleVolume[]) : [];
    }

    lastStatus = res?.status;

    // 4xx other than 429 is a permanent client error — no point retrying.
    if (res && res.status < 500 && res.status !== 429) {
      throw new BookProviderUnavailableError(
        `Google Books rejected the request (HTTP ${res.status})`,
        res.status,
      );
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  throw new BookProviderUnavailableError(
    `Google Books unavailable after ${MAX_ATTEMPTS} attempts` +
      (lastStatus ? ` (last status ${lastStatus})` : ""),
    lastStatus,
  );
}

/**
 * Cache successful lookups only. A BookProviderUnavailableError propagates
 * uncached — caching a 503 as an empty result would hide the book until the
 * TTL expired.
 */
async function cachedVolumes(
  cacheKey: string,
  ttl: number,
  loader: () => Promise<ProviderBook[]>,
): Promise<ProviderBook[]> {
  const hit = await getJsonCache<ProviderBook[]>(cacheKey);
  if (hit) return hit;
  const fresh = await loader();
  if (fresh.length > 0) await setJsonCache(cacheKey, fresh, ttl);
  return fresh;
}

/** Exported for tests; production code goes through getBookMetadataProvider. */
export class GoogleBooksProvider implements BookIdentityProvider {
  readonly source = "googlebooks" as const;

  constructor(
    private readonly apiKey: string,
    private readonly country: string,
  ) {}

  private async run(
    query: string,
    limit: number,
    langRestrict?: string,
  ): Promise<ProviderBook[]> {
    const raw = await fetchVolumes(
      query,
      this.apiKey,
      this.country,
      limit,
      langRestrict,
    );
    return raw.map(mapVolume).filter((b): b is ProviderBook => b !== null);
  }

  async searchBooks(
    query: string,
    opts?: { limit?: number },
  ): Promise<ProviderBook[]> {
    const term = sanitizeTerm(query);
    if (!term) return [];
    const limit = opts?.limit ?? 20;

    // A bare ISBN is by far the most precise signal, so route it accordingly.
    const digits = isbnDigits(term);
    if (/^\d{10}(\d{3})?$/.test(digits)) {
      const byIsbn = await this.resolveIsbn(digits);
      return byIsbn ? [byIsbn] : [];
    }

    return cachedVolumes(
      `books:gb:search:${this.country}:${term.toLowerCase()}:${limit}`,
      CACHE_TTL_SEARCH,
      () => this.run(term, limit),
    );
  }

  async getBook(volumeId: string): Promise<ProviderBook | null> {
    const id = sanitizeTerm(volumeId);
    if (!id) return null;
    const cacheKey = `books:gb:volume:${id}`;
    const hit = await getJsonCache<ProviderBook>(cacheKey);
    if (hit) return hit;

    const url = new URL(`${API_BASE}/${encodeURIComponent(id)}`);
    url.searchParams.set("country", this.country);
    url.searchParams.set("key", this.apiKey);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);

      if (res?.ok) {
        const body = (await res
          .json()
          .catch(() => null)) as GoogleVolume | null;
        const mapped = body ? mapVolume(body) : null;
        if (mapped) await setJsonCache(cacheKey, mapped, CACHE_TTL_VOLUME);
        return mapped;
      }
      if (res?.status === 404) return null;
      if (res && res.status < 500 && res.status !== 429) {
        throw new BookProviderUnavailableError(
          `Google Books rejected the request (HTTP ${res.status})`,
          res.status,
        );
      }
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
    throw new BookProviderUnavailableError(
      `Google Books unavailable after ${MAX_ATTEMPTS} attempts`,
    );
  }

  async resolveIsbn(
    isbn13: string,
    opts?: { strict?: boolean },
  ): Promise<ProviderBook | null> {
    const digits = isbnDigits(isbn13);
    const canonical = toIsbn13(digits);
    if (!canonical) return null;
    // Cache key bumped to v2: v1 stored the first Google hit regardless of
    // whether it carried the queried ISBN, and those wrong answers live for
    // 24h. Busting the key is cheaper than teaching the picker to un-poison
    // a stale singleton list.
    const results = await cachedVolumes(
      `books:gb:isbn:v2:${digits}`,
      CACHE_TTL_VOLUME,
      () => this.run(`isbn:${digits}`, ISBN_LOOKUP_LIMIT),
    );
    // Queried as typed — Google indexes both lengths — but matched against the
    // canonical 13-digit form, which is the only one a volume record carries.
    const picked = pickBookForIsbn(results, canonical, opts);
    return picked ? pinQueriedIsbn(picked, canonical) : null;
  }

  async getAuthorBooks(
    authorName: string,
    opts?: { limit?: number; languages?: string[] },
  ): Promise<ProviderBook[]> {
    const name = sanitizeTerm(authorName);
    if (!name) return [];
    const limit = opts?.limit ?? 40;
    const languages = [
      ...new Set(
        (opts?.languages ?? [])
          .map((l) => l.trim().toLowerCase())
          .filter((l) => /^[a-z]{2}$/.test(l)),
      ),
    ].sort();

    // langRestrict is part of the cache key: the unrestricted result and the
    // fr-only result are different answers to different questions.
    const cacheKey = `books:gb:author:${this.country}:${name.toLowerCase()}:${limit}:${
      languages.join(",") || "any"
    }`;

    return cachedVolumes(cacheKey, CACHE_TTL_SEARCH, async () => {
      if (languages.length === 0) return this.run(`inauthor:${name}`, limit);

      const byVolume = new Map<string, ProviderBook>();
      for (const lang of languages) {
        const found = await this.run(`inauthor:${name}`, limit, lang);
        for (const book of found) {
          if (!byVolume.has(book.volumeId)) byVolume.set(book.volumeId, book);
        }
      }
      return [...byVolume.values()];
    });
  }

  async enrich(book: BookMatchInput): Promise<ProviderFields> {
    const volumeId = book.externalIds.googlebooks ?? book.googleVolumeId;
    if (!volumeId) return {};
    const meta = await this.getBook(volumeId);
    if (!meta) return {};
    // Only the fields Google actually supplies. Everything it does not know is
    // absent rather than null, so a lower-priority source can still fill it.
    const fields: ProviderFields = {
      title: meta.title,
      subtitle: meta.subtitle,
      authors: meta.authors,
      language: meta.language,
      publishedYear: meta.publishedYear,
      isbn13: meta.isbn13,
      coverUrl: meta.coverUrl,
      overview: meta.overview,
      seriesName: meta.seriesName,
      seriesPosition: meta.seriesPosition,
    };
    /**
     * Never overwrite an ISBN the book already has — the same rule Audnexus
     * follows.
     *
     * A volume record lists one ISBN_13 as primary and it is regularly a
     * sibling printing's, so contributing it walks the operator's typed
     * identifier away on the very next refresh. Filling an empty isbn13 is
     * still useful.
     */
    if (book.isbn13) delete fields.isbn13;
    return fields;
  }
}

/**
 * Returns the configured provider, or null when Google Books is not set up.
 * Books require a key: keyless Google Books is quota-exhausted in practice, so
 * there is no useful degraded mode.
 */
export async function getBookMetadataProvider(): Promise<BookIdentityProvider | null> {
  const cfg = await loadConfig();
  if (!cfg) return null;
  const country = await loadCountry();
  return new GoogleBooksProvider(cfg.apiKey, country);
}
