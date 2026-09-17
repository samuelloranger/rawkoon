import type {
  BookDiscoveryBook,
  BookDiscoverySourcesResponse,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { getBookMetadataProvider } from "@rawkoon/api/services/books";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import {
  getDiscoverySource,
  listDiscoverySources,
  type RankedEntry,
} from "@rawkoon/api/services/books/discoverySources";

const ENRICHED_TTL = 12 * 60 * 60;
const ENRICH_CONCURRENCY = 5;

/** Enriched item WITHOUT the membership flag, which is computed post-cache. */
type EnrichedBook = Omit<BookDiscoveryBook, "alreadyInLibrary">;

/**
 * Resolve each entry's ISBN through the provider chain for a `volumeId` (needed
 * to add the book) and to fill any missing author/overview/year/cover.
 * Source-supplied fields win over enrichment. A per-ISBN failure degrades that
 * one card, never the whole shelf.
 */
async function enrichEntries(entries: RankedEntry[]): Promise<EnrichedBook[]> {
  const provider = await getBookMetadataProvider();
  const out: EnrichedBook[] = new Array(entries.length);

  const worker = async (start: number) => {
    for (let i = start; i < entries.length; i += ENRICH_CONCURRENCY) {
      const e = entries[i];
      let volumeId: string | null = null;
      let author = e.author;
      let overview = e.overview;
      let publishedYear: number | null = null;
      let coverUrl = e.coverUrl;
      if (provider && e.isbn13) {
        const meta = await provider.resolveIsbn(e.isbn13).catch(() => null);
        if (meta) {
          volumeId = meta.volumeId;
          author = author ?? meta.authors[0] ?? null;
          overview = overview ?? meta.overview;
          publishedYear = meta.publishedYear;
          coverUrl = coverUrl ?? meta.coverUrl;
        }
      }
      out[i] = {
        rank: e.rank,
        title: e.title,
        isbn13: e.isbn13,
        coverUrl,
        sourceUrl: e.sourceUrl,
        author,
        overview,
        publishedYear,
        volumeId,
      };
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(ENRICH_CONCURRENCY, entries.length) },
      (_, k) => worker(k),
    ),
  );
  return out;
}

/** ISBNs already in the library, for the `alreadyInLibrary` flag. */
async function membershipFlags(items: EnrichedBook[]): Promise<Set<string>> {
  const isbns = items
    .map((i) => i.isbn13)
    .filter((v): v is string => v != null);
  if (isbns.length === 0) return new Set();
  const rows = await prisma.libraryBook.findMany({
    where: { isbn13: { in: isbns } },
    select: { isbn13: true },
  });
  return new Set(
    rows.map((r) => r.isbn13).filter((v): v is string => v != null),
  );
}

export async function getDiscovery(
  sourceId: string,
  listId: string,
): Promise<{ source: string; list: string; items: BookDiscoveryBook[] }> {
  const source = getDiscoverySource(sourceId);
  if (!source) throw new Error(`unknown discovery source: ${sourceId}`);

  // The enriched list (without membership) is cached so the ISBN lookups run
  // once per window; membership is layered on after, as it changes faster.
  const cacheKey = `books:discovery:enriched:${source.id}:${listId}`;
  let enriched = await getJsonCache<EnrichedBook[]>(cacheKey);
  if (!enriched) {
    const entries = await source.fetch(listId);
    enriched = await enrichEntries(entries);
    if (enriched.length > 0) {
      await setJsonCache(cacheKey, enriched, ENRICHED_TTL);
    }
  }

  const inLibrary = await membershipFlags(enriched);
  const items: BookDiscoveryBook[] = enriched.map((b) => ({
    ...b,
    alreadyInLibrary: b.isbn13 != null && inLibrary.has(b.isbn13),
  }));
  return { source: source.id, list: listId, items };
}

export async function getConfiguredSources(): Promise<BookDiscoverySourcesResponse> {
  const sources: BookDiscoverySourcesResponse["sources"] = [];
  for (const s of listDiscoverySources()) {
    if (!(await s.isConfigured())) continue;
    sources.push({ id: s.id, label: s.label, lists: await s.lists() });
  }
  return { sources };
}
