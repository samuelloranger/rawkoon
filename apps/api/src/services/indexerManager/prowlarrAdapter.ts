import type {
  IndexerManagerAdapter,
  IndexerSearchParams,
  IndexerWarning,
  NormalizedRelease,
  NormalizedIndexer,
  GrabResult,
  SearchResult,
} from "./types";
import type { IndexerIntegrationConfig } from "../../utils/integrations/types";
import {
  toRecord,
  toStringOrNull,
  toNumberOrNull,
  extractProwlarrDownloadTarget,
  infoHashFromMagnet,
  toBoolean,
} from "../../utils/medias/prowlarrSearchUtils";
import { randomUUID } from "crypto";

const RELEASE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const releasePayloads = new Map<
  string,
  { payload: Record<string, unknown>; expiresAt: number }
>();

function cleanupExpired() {
  const now = Date.now();
  for (const [token, entry] of releasePayloads.entries()) {
    if (entry.expiresAt <= now) releasePayloads.delete(token);
  }
}

// Sweep on a timer too — store/take may go idle after a burst, leaving expired
// entries pinned. unref so this never keeps the process alive.
setInterval(cleanupExpired, RELEASE_TTL_MS).unref?.();

function storePayload(payload: Record<string, unknown>): string {
  cleanupExpired();
  const token = randomUUID();
  releasePayloads.set(token, {
    payload,
    expiresAt: Date.now() + RELEASE_TTL_MS,
  });
  return token;
}

function takePayload(token: string): Record<string, unknown> | null {
  cleanupExpired();
  const entry = releasePayloads.get(token);
  if (!entry) return null;
  releasePayloads.delete(token);
  return entry.payload;
}

export class ProwlarrAdapter implements IndexerManagerAdapter {
  readonly name = "prowlarr" as const;
  private readonly config: IndexerIntegrationConfig;

  constructor(config: IndexerIntegrationConfig) {
    this.config = config;
  }

  private headers(): Record<string, string> {
    return {
      "X-Api-Key": this.config.api_key,
      Accept: "application/json",
    };
  }

  private baseUrl(): string {
    return this.config.website_url.replace(/\/+$/, "");
  }

  private async fetchIndexerStatus(): Promise<IndexerWarning[]> {
    const base = this.baseUrl();

    const [statusRes, indexersRes] = await Promise.all([
      fetch(`${base}/api/v1/indexerstatus`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null),
      fetch(`${base}/api/v1/indexer`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null),
    ]);

    if (!statusRes?.ok) return [];

    const statuses = await statusRes.json().catch(() => null);
    if (!Array.isArray(statuses)) return [];

    const nameMap = new Map<number, string>();
    if (indexersRes?.ok) {
      const indexers = await indexersRes.json().catch(() => null);
      if (Array.isArray(indexers)) {
        for (const idx of indexers as Record<string, unknown>[]) {
          if (typeof idx?.id === "number" && typeof idx?.name === "string") {
            nameMap.set(idx.id, idx.name);
          }
        }
      }
    }

    const now = new Date();
    const warnings: IndexerWarning[] = [];

    for (const s of statuses as Record<string, unknown>[]) {
      if (
        typeof s !== "object" ||
        s === null ||
        typeof s.indexerId !== "number"
      )
        continue;
      const disabledTill = s.disabledTill
        ? new Date(s.disabledTill as string)
        : null;
      if (!disabledTill || disabledTill <= now) continue;
      const id = String(s.indexerId);
      warnings.push({
        id,
        name: nameMap.get(s.indexerId) ?? id,
        error: "temporarily blocked by Prowlarr",
      });
    }

    return warnings;
  }

  async search(params: IndexerSearchParams): Promise<SearchResult> {
    // Bounded call — await so blocked-indexer warnings are populated
    // reliably instead of racing the search response.
    const indexerWarnings: IndexerWarning[] =
      await this.fetchIndexerStatus().catch(() => []);

    const url = new URL("/api/v1/search", this.config.website_url);
    const limit = String(params.limit ?? 100);

    if (params.type === "tvsearch") {
      url.searchParams.set("type", "tvsearch");
      url.searchParams.set("limit", limit);
      if (params.season != null)
        url.searchParams.set("season", String(params.season));
      if (params.tmdbId != null) {
        url.searchParams.set("tmdbid", String(params.tmdbId));
      } else if (params.query) {
        url.searchParams.set("query", params.query);
      }
    } else {
      url.searchParams.set("type", "search");
      url.searchParams.set("query", params.query ?? "");
      url.searchParams.set("limit", limit);
    }

    // Category filtering: 2000 = Movies, 5000 = TV
    if (params.mediaType === "movie") {
      url.searchParams.set("categories", "2000");
    } else if (params.mediaType === "tv") {
      url.searchParams.set("categories", "5000");
    }

    const res = await fetch(url.toString(), {
      headers: this.headers(),
      signal: AbortSignal.timeout(25_000),
    }).catch(() => null);

    if (!res?.ok) return { releases: [], indexerWarnings };

    const body = await res.json().catch(() => null);
    if (!Array.isArray(body)) return { releases: [], indexerWarnings };

    const base = this.baseUrl();
    const releases = body
      .map((raw: unknown) => this.normalizeRelease(raw, base))
      .filter((r): r is NormalizedRelease => r !== null);
    return { releases, indexerWarnings };
  }

  async getIndexers(): Promise<NormalizedIndexer[]> {
    const url = new URL("/api/v1/indexer", this.config.website_url);
    const res = await fetch(url.toString(), {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    if (!res?.ok) return [];

    const raw = (await res.json().catch(() => [])) as Array<
      Record<string, unknown>
    >;

    const indexers = raw.map((item) => ({
      id: Number(item.id),
      slug: String(item.id),
      name: String(item.name ?? ""),
      protocol: String(item.protocol ?? "torrent"),
      enabled: Boolean(item.enable),
      privacy: String(item.privacy ?? "public"),
    }));

    indexers.sort((a, b) => {
      if (a.privacy === b.privacy) return a.name.localeCompare(b.name);
      return a.privacy === "private" ? -1 : 1;
    });

    return indexers;
  }

  async grabRelease(token: string): Promise<GrabResult> {
    const payload = takePayload(token);
    if (!payload) {
      return { success: false, error: "Release token expired or not found" };
    }

    const searchUrl = new URL("/api/v1/search", this.config.website_url);
    const res = await fetch(searchUrl.toString(), {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (!res?.ok) {
      return {
        success: false,
        error: `Prowlarr grab failed (${res?.status ?? "network error"})`,
      };
    }

    return { success: true };
  }

  storeReleaseToken(release: NormalizedRelease): string | null {
    if (!release.rawPayload) return null;
    return storePayload(release.rawPayload);
  }

  async fetchRss(indexerIds: string[]): Promise<NormalizedRelease[]> {
    const url = new URL("/api/v1/search", this.config.website_url);
    url.searchParams.set("type", "search");
    url.searchParams.set("query", "");
    url.searchParams.set("categories", "2000,5000");
    url.searchParams.set("limit", "100");
    for (const id of indexerIds) {
      url.searchParams.append("indexerIds", id);
    }
    const res = await fetch(url.toString(), {
      headers: this.headers(),
      signal: AbortSignal.timeout(25_000),
    }).catch((err: unknown) => {
      console.warn(
        `[ProwlarrAdapter] fetchRss failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
    if (!res) return [];
    if (!res.ok) {
      console.warn(`[ProwlarrAdapter] fetchRss non-OK response: ${res.status}`);
      return [];
    }
    const body = await res.json().catch(() => null);
    if (!Array.isArray(body)) return [];
    const base = this.baseUrl();
    return body
      .map((raw: unknown) => this.normalizeRelease(raw, base))
      .filter((r): r is NormalizedRelease => r !== null);
  }

  private normalizeRelease(
    raw: unknown,
    baseUrl: string,
  ): NormalizedRelease | null {
    const row = toRecord(raw);
    if (!row) return null;

    const guid = toStringOrNull(row.guid);
    const title = toStringOrNull(row.title);
    if (!guid || !title) return null;

    const target = extractProwlarrDownloadTarget(row, baseUrl);
    const magnetUrl = target?.isMagnet ? target.url : null;
    const downloadUrl = target && !target.isMagnet ? target.url : null;

    const rejections = Array.isArray(row.rejections) ? row.rejections : [];
    const rejectionStrings = rejections
      .map((r) => {
        const record = toRecord(r);
        return (
          toStringOrNull(record?.reason) || toStringOrNull(record?.type) || null
        );
      })
      .filter((v): v is string => Boolean(v));

    const indexerRecord = toRecord(row.indexer);

    return {
      guid,
      title,
      indexer:
        toStringOrNull(row.indexer) ||
        toStringOrNull(indexerRecord?.name) ||
        toStringOrNull(indexerRecord?.title) ||
        null,
      indexerId:
        toNumberOrNull(row.indexerId) ||
        toNumberOrNull(row.indexerID) ||
        toNumberOrNull(indexerRecord?.id) ||
        null,
      languages: extractLanguages(row),
      protocol: toStringOrNull(row.protocol),
      sizeBytes: toNumberOrNull(row.size),
      age: toNumberOrNull(row.age),
      seeders: toNumberOrNull(row.seeders),
      leechers: toNumberOrNull(row.leechers),
      rejected: toBoolean(row.rejected),
      rejections: rejectionStrings,
      infoUrl: toStringOrNull(row.infoUrl),
      downloadUrl,
      magnetUrl,
      infoHash:
        toStringOrNull(row.infoHash) ||
        (magnetUrl ? infoHashFromMagnet(magnetUrl) : null),
      tmdbId: toNumberOrNull(row.tmdbId) ?? null,
      freeleech: false, // Prowlarr doesn't expose downloadVolumeFactor
      rawPayload: row,
    };
  }
}

/** Extract language strings from Prowlarr's nested languages array. */
function extractLanguages(row: Record<string, unknown>): string[] {
  const langs = row.languages;
  if (!Array.isArray(langs)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of langs) {
    const record = toRecord(entry);
    const name = toStringOrNull(record?.name) || toStringOrNull(entry);
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}
