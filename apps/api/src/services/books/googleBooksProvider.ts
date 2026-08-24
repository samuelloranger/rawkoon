import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeGoogleBooksConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { prisma } from "@rawkoon/api/db";
import {
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

class GoogleBooksProvider implements BookIdentityProvider {
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
    const digits = term.replace(/[\s-]/g, "");
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

  async resolveIsbn(isbn13: string): Promise<ProviderBook | null> {
    const digits = isbn13.replace(/[\s-]/g, "");
    if (!/^\d{10}(\d{3})?$/.test(digits)) return null;
    const results = await cachedVolumes(
      `books:gb:isbn:${digits}`,
      CACHE_TTL_VOLUME,
      () => this.run(`isbn:${digits}`, 1),
    );
    return results[0] ?? null;
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
    return {
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
