import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import {
  AUDNEXUS_DEFAULT_REGION,
  normalizeAudnexusConfig,
} from "@rawkoon/api/utils/integrations/normalizers";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { sanitizeProviderHtml } from "@rawkoon/shared/utils";
import {
  normalizeSeriesName,
  parseSeriesPosition,
} from "@rawkoon/api/utils/books/seriesName";
import { searchAudibleProducts } from "./audibleCatalog";
import { pickBestAsin } from "./asinResolver";
import {
  BookProviderUnavailableError,
  type BookMatchInput,
  type BookMetadataProvider,
  type ProviderFields,
} from "./types";

/**
 * Audnexus (GPL-3.0) is the API Audiobookshelf uses by default. Verified live
 * 2026-08-24: the public instance is keyless and rate-limits at 300 requests
 * per 60s per IP, Cloudflare-cached for 24h.
 *
 * Two facts shape this file:
 *  - There is no book title search, so an ASIN must be resolved from the
 *    Audible catalog first (audibleCatalog.ts + asinResolver.ts).
 *  - `region` must be passed explicitly on every call; it is not inferred.
 */

const CACHE_TTL_BOOK = 86_400; // 24h, matching Audnexus' own cache-control.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const LANG_ALIASES: Record<string, string> = {
  french: "fr",
  english: "en",
  german: "de",
  spanish: "es",
  italian: "it",
  japanese: "ja",
  portuguese: "pt",
};

const toIso639 = (raw: string | null): string | null => {
  if (!raw) return null;
  const key = raw.toLowerCase();
  return LANG_ALIASES[key] ?? (/^[a-z]{2}$/.test(key) ? key : null);
};

/** `[{ name }]` -> `["name"]`, dropping anything unnamed. */
const namesOf = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const entry of v) {
    if (!entry || typeof entry !== "object") continue;
    const name = str((entry as Record<string, unknown>).name);
    if (name) out.push(name);
  }
  return out;
};

export function mapAudnexusBook(raw: unknown): ProviderFields {
  if (!raw || typeof raw !== "object") return {};
  const b = raw as Record<string, unknown>;
  const asin = str(b.asin);
  const title = str(b.title);
  if (!asin || !title) return {};

  const series = b.seriesPrimary as Record<string, unknown> | undefined;
  const releaseDate = str(b.releaseDate);
  // `rating` arrives as a string.
  const ratingRaw = Number(str(b.rating) ?? Number.NaN);

  const fields: ProviderFields = {
    title,
    subtitle: str(b.subtitle),
    narrators: namesOf(b.narrators),
    // Audible splits its taxonomy into `genre` and `tag`. Both are genres
    // here; the type must not leak into the stored value.
    genres: namesOf(b.genres),
    publisher: str(b.publisherName),
    isbn13: str(b.isbn),
    coverUrl: str(b.image),
    // Sanitized on ingest so the database only ever holds clean HTML, matching
    // what the Google Books provider already does.
    overview:
      sanitizeProviderHtml(str(b.summary) ?? str(b.description) ?? "") || null,
    seriesName: normalizeSeriesName(str(series?.name)),
    seriesPosition: parseSeriesPosition(series?.position),
    language: toIso639(str(b.language)),
    rating: Number.isFinite(ratingRaw) ? ratingRaw : null,
  };

  if (releaseDate) {
    fields.publishedDate = releaseDate;
    const year = Number(releaseDate.slice(0, 4));
    if (Number.isFinite(year)) fields.publishedYear = year;
  }
  return fields;
}

/**
 * Author payloads are a different shape from book payloads — `name`, not
 * `title` — so they get their own mapper rather than one function sniffing
 * which kind it was handed.
 */
export function mapAudnexusAuthor(raw: unknown): ProviderFields {
  if (!raw || typeof raw !== "object") return {};
  const a = raw as Record<string, unknown>;
  const asin = str(a.asin);
  if (!asin) return {};

  const fields: ProviderFields = {};
  const image = str(a.image);
  if (image) fields.authorImageUrl = image;
  // An empty description is missing data, not an assertion of emptiness, so
  // the key stays absent: a lower-priority source or another region can still
  // supply it.
  const bio = str(a.description);
  if (bio) fields.authorBio = bio;
  return fields;
}

/** The author search returns the same ASIN many times over. */
export function dedupeAudnexusAuthors(
  raw: unknown,
): Array<{ asin: string; name: string }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ asin: string; name: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const asin = str(e.asin);
    const name = str(e.name);
    if (!asin || !name || seen.has(asin)) continue;
    seen.add(asin);
    out.push({ asin, name });
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown | null> {
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (res?.ok) return await res.json().catch(() => null);
    // 404 is "no such ASIN", which is a real answer rather than an outage.
    if (res?.status === 404) return null;
    lastStatus = res?.status;
    if (res && res.status < 500 && res.status !== 429) {
      throw new BookProviderUnavailableError(
        `Audnexus rejected the request (HTTP ${res.status})`,
        res.status,
      );
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  throw new BookProviderUnavailableError(
    `Audnexus unavailable after ${MAX_ATTEMPTS} attempts` +
      (lastStatus ? ` (last status ${lastStatus})` : ""),
    lastStatus,
  );
}

export class AudnexusProvider implements BookMetadataProvider {
  readonly source = "audnexus" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly region: string,
  ) {}

  /** Resolve an ASIN from the Audible catalog. Null means "no confident match". */
  async resolveAsin(book: BookMatchInput): Promise<string | null> {
    const candidates = await searchAudibleProducts(
      `${book.title} ${book.authors.join(" ")}`,
      { region: this.region, limit: 5 },
    );
    const match = pickBestAsin(
      { title: book.title, authors: book.authors, language: book.language },
      candidates,
    );
    return match?.candidate.asin ?? null;
  }

  /** Fetch one ASIN's record, or null when this region does not carry it. */
  private async fetchBook(asin: string): Promise<ProviderFields | null> {
    const cacheKey = `books:audnexus:book:${this.region}:${asin}`;
    const cached = await getJsonCache<ProviderFields>(cacheKey);
    if (cached) return cached;

    const raw = await fetchJson(
      `${this.baseUrl}/books/${encodeURIComponent(asin)}?region=${encodeURIComponent(this.region)}`,
    );
    if (!raw) return null;
    const fields = mapAudnexusBook(raw);
    if (Object.keys(fields).length === 0) return null;
    await setJsonCache(cacheKey, fields, CACHE_TTL_BOOK);
    return fields;
  }

  async enrich(book: BookMatchInput): Promise<ProviderFields> {
    const stored = book.externalIds.audnexus;

    if (stored) {
      const fields = await this.fetchBook(stored);
      if (fields) return this.withAsin(book, fields, stored);
      /**
       * The stored ASIN is not in this region's catalogue.
       *
       * ASINs are regional and the stored id carries no region, so changing
       * the configured region strands every book that had already resolved:
       * the old id 404s here forever and resolution is never retried. Falling
       * through re-resolves against the current region, and the newly found id
       * replaces the stale one via __asin.
       */
      console.warn(
        `[audnexus] stored ASIN ${stored} is unknown in region ${this.region} — re-resolving`,
      );
    }

    const asin = await this.resolveAsin(book);
    if (!asin || asin === stored) return {};
    const fields = await this.fetchBook(asin);
    if (!fields) return {};
    // The resolved ASIN travels back so the caller can persist it.
    return this.withAsin(book, fields, asin);
  }

  /**
   * Attach the ASIN id, and drop isbn13 when the book already has one.
   *
   * Audnexus ranks above Google Books. Its ISBN is often an Audible-region
   * product code for a different language edition of the same title, so
   * contributing it would overwrite the ISBN the operator typed at add time.
   * Filling an empty isbn13 is still useful.
   */
  private withAsin(
    book: BookMatchInput,
    fields: ProviderFields,
    asin: string,
  ): ProviderFields {
    if (!book.isbn13) return { ...fields, __asin: asin };
    const rest = { ...fields };
    delete rest.isbn13;
    return { ...rest, __asin: asin };
  }

  /**
   * Author bio and image.
   *
   * The FR region was observed returning a good image with an EMPTY
   * description, so the bio — and only the bio — falls back to the default
   * region. The image from the requested region is correct and is kept.
   */
  async enrichAuthor(authorName: string): Promise<ProviderFields> {
    const list = dedupeAudnexusAuthors(
      await fetchJson(
        `${this.baseUrl}/authors?name=${encodeURIComponent(authorName)}&region=${encodeURIComponent(this.region)}`,
      ),
    );
    const first = list[0];
    if (!first) return {};

    const primary = mapAudnexusAuthor(
      await fetchJson(
        `${this.baseUrl}/authors/${encodeURIComponent(first.asin)}?region=${encodeURIComponent(this.region)}`,
      ),
    );
    if (primary.authorBio) return { ...primary, __asin: first.asin };

    if (this.region === AUDNEXUS_DEFAULT_REGION) {
      return { ...primary, __asin: first.asin };
    }
    const fallback = mapAudnexusAuthor(
      await fetchJson(
        `${this.baseUrl}/authors/${encodeURIComponent(first.asin)}?region=${AUDNEXUS_DEFAULT_REGION}`,
      ),
    );
    return {
      ...primary,
      ...(fallback.authorBio ? { authorBio: fallback.authorBio } : {}),
      __asin: first.asin,
    };
  }
}

export async function getAudnexusProvider(): Promise<AudnexusProvider | null> {
  const row = await getIntegrationConfigRecord("audnexus");
  if (!row?.enabled) return null;
  const cfg = normalizeAudnexusConfig(row.config ?? {});
  if (!cfg) return null;
  return new AudnexusProvider(cfg.base_url, cfg.region);
}
