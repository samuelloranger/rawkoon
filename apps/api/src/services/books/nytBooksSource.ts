import type { BookDiscoveryList } from "@rawkoon/shared/types";
import type {
  BookDiscoverySource,
  RankedEntry,
} from "@rawkoon/api/services/books/discoverySources";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeNytBooksConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { BookProviderUnavailableError } from "@rawkoon/api/services/books/types";

const BASE = "https://api.nytimes.com/svc/books/v3";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const LIST_CACHE_TTL = 12 * 60 * 60;

/**
 * A curated subset of NYT weekly lists. The full `names.json` list is large and
 * mostly niche; these are the ones a general library cares about. Validating an
 * incoming list id against this set also stops the endpoint being used to probe
 * arbitrary NYT list slugs.
 */
const DEFAULT_LISTS: BookDiscoveryList[] = [
  { id: "combined-print-and-e-book-fiction", label: "Fiction" },
  { id: "combined-print-and-e-book-nonfiction", label: "Nonfiction" },
  { id: "young-adult-hardcover", label: "Young adult" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadKey(): Promise<string | null> {
  const row = await getIntegrationConfigRecord("nyt");
  if (!row?.enabled) return null;
  const cfg = normalizeNytBooksConfig(row.config);
  return cfg?.api_key ?? null;
}

/** Map a `lists/current/{list}.json` payload into ranked entries. */
export function mapNytList(payload: unknown): RankedEntry[] {
  const books = (payload as { results?: { books?: unknown[] } })?.results
    ?.books;
  if (!Array.isArray(books)) return [];
  const entries: RankedEntry[] = [];
  const seen = new Set<string>();
  for (const raw of books) {
    const b = raw as Record<string, unknown>;
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title) continue;
    const isbn13 =
      typeof b.primary_isbn13 === "string" && /^\d{13}$/.test(b.primary_isbn13)
        ? b.primary_isbn13
        : null;
    if (isbn13 && seen.has(isbn13)) continue;
    if (isbn13) seen.add(isbn13);
    const rank = typeof b.rank === "number" ? b.rank : entries.length + 1;
    entries.push({
      rank,
      title,
      isbn13,
      coverUrl: typeof b.book_image === "string" ? b.book_image : null,
      sourceUrl:
        typeof b.amazon_product_url === "string" ? b.amazon_product_url : null,
      author: typeof b.author === "string" ? b.author.trim() || null : null,
      overview:
        typeof b.description === "string" ? b.description.trim() || null : null,
      publishedYear: null,
    });
  }
  entries.sort((a, b) => a.rank - b.rank);
  return entries;
}

/**
 * Fetch NYT JSON with retry on 5xx/429. Throws BookProviderUnavailableError so
 * a transient failure is never cached and is distinguishable from "no results".
 */
async function fetchNytJson(path: string, apiKey: string): Promise<unknown> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}api-key=${encodeURIComponent(apiKey)}`;
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => null);
    if (res?.ok) return res.json().catch(() => null);
    lastStatus = res?.status;
    // 4xx other than 429 is permanent (bad key / bad list).
    if (res && res.status < 500 && res.status !== 429) {
      throw new BookProviderUnavailableError(
        `NYT Books rejected the request (HTTP ${res.status})`,
        res.status,
      );
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  throw new BookProviderUnavailableError(
    `NYT Books unavailable after ${MAX_ATTEMPTS} attempts` +
      (lastStatus ? ` (last status ${lastStatus})` : ""),
    lastStatus,
  );
}

export function createNytSource(): BookDiscoverySource {
  return {
    id: "nyt",
    label: "NYT Bestsellers",
    isConfigured: async () => (await loadKey()) !== null,
    lists: async () => DEFAULT_LISTS,
    fetch: async (listId) => {
      const apiKey = await loadKey();
      if (!apiKey) return [];
      if (!DEFAULT_LISTS.some((l) => l.id === listId)) return [];
      const cacheKey = `books:discovery:nyt:raw:${listId}`;
      const cached = await getJsonCache<RankedEntry[]>(cacheKey);
      if (cached) return cached;
      const payload = await fetchNytJson(
        `/lists/current/${encodeURIComponent(listId)}.json`,
        apiKey,
      );
      const entries = mapNytList(payload);
      if (entries.length > 0) {
        await setJsonCache(cacheKey, entries, LIST_CACHE_TTL);
      }
      return entries;
    },
  };
}
