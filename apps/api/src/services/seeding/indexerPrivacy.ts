import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";

const CACHE_KEY = "seeding:indexer-privacy:v1";
const CACHE_TTL_SECS = 3600;

export interface PrivacyDeps {
  getCache: () => Promise<Array<[string, boolean]> | null>;
  setCache: (entries: Array<[string, boolean]>) => Promise<void>;
  listIndexers: () => Promise<Array<{ name: string; privacy: string }> | null>;
}

const defaultDeps: PrivacyDeps = {
  getCache: () => getJsonCache<Array<[string, boolean]>>(CACHE_KEY),
  setCache: (entries) => setJsonCache(CACHE_KEY, entries, CACHE_TTL_SECS),
  listIndexers: async () => {
    const { getActiveIndexerManager } = await import(
      "@rawkoon/api/services/indexerManager"
    );
    const manager = await getActiveIndexerManager();
    return manager ? manager.getIndexers() : null;
  },
};

/** Indexer name (trimmed, lowercased) → isPrivate. Empty when unknown; callers treat absent as private. */
export async function loadIndexerPrivacy(
  deps: PrivacyDeps = defaultDeps,
): Promise<Map<string, boolean>> {
  const cached = await deps.getCache().catch(() => null);
  if (cached) return new Map(cached);
  try {
    const list = await deps.listIndexers();
    if (!list) return new Map();
    const entries = list.map(
      (i) =>
        [i.name.trim().toLowerCase(), i.privacy !== "public"] as [
          string,
          boolean,
        ],
    );
    await deps.setCache(entries).catch(() => {});
    return new Map(entries);
  } catch {
    return new Map();
  }
}

/** Display names for the per-indexer rules table; empty when the manager is unreachable. */
export async function listKnownIndexers(
  deps: PrivacyDeps = defaultDeps,
): Promise<Array<{ name: string; isPrivate: boolean }>> {
  try {
    const list = (await deps.listIndexers()) ?? [];
    return list.map((i) => ({
      name: i.name.trim(),
      isPrivate: i.privacy !== "public",
    }));
  } catch {
    return [];
  }
}
