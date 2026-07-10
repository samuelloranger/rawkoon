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
import { randomUUID } from "crypto";

const RELEASE_TTL_MS = 10 * 60 * 1000;

const releasePayloads = new Map<
  string,
  { url: string; isMagnet: boolean; expiresAt: number }
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

function storeDownloadUrl(url: string, isMagnet: boolean): string {
  cleanupExpired();
  const token = randomUUID();
  releasePayloads.set(token, {
    url,
    isMagnet,
    expiresAt: Date.now() + RELEASE_TTL_MS,
  });
  return token;
}

function takeDownloadUrl(
  token: string,
): { url: string; isMagnet: boolean } | null {
  cleanupExpired();
  const entry = releasePayloads.get(token);
  if (!entry) return null;
  releasePayloads.delete(token);
  return { url: entry.url, isMagnet: entry.isMagnet };
}

export class JackettAdapter implements IndexerManagerAdapter {
  readonly name = "jackett" as const;
  private readonly config: IndexerIntegrationConfig;

  constructor(config: IndexerIntegrationConfig) {
    this.config = config;
  }

  async search(params: IndexerSearchParams): Promise<SearchResult> {
    const url = new URL(
      "/api/v2.0/indexers/all/results",
      this.config.website_url,
    );
    url.searchParams.set("apikey", this.config.api_key);

    if (params.query) {
      url.searchParams.set("Query", params.query);
    }

    if (params.mediaType === "movie") {
      url.searchParams.append("Category[]", "2000");
    } else if (params.mediaType === "tv" || params.type === "tvsearch") {
      url.searchParams.append("Category[]", "5000");
    }

    if (params.tmdbId != null) {
      url.searchParams.set("tmdbid", String(params.tmdbId));
    }

    // 45 s gives Jackett enough time to collect results even when one indexer
    // hits its own 20-30 s timeout, so we always get the Indexers error list.
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    }).catch(() => null);

    // Surface a whole-Jackett connectivity/auth failure as a warning so it
    // reaches the UI instead of looking like an empty (but successful) search.
    if (!res) {
      console.error(
        `[JackettAdapter] search could not reach Jackett at ${this.config.website_url}`,
      );
      return { releases: [], indexerWarnings: [this.connectionWarning(null)] };
    }
    if (!res.ok) {
      console.error(
        `[JackettAdapter] search returned HTTP ${res.status} from ${this.config.website_url}`,
      );
      return {
        releases: [],
        indexerWarnings: [this.connectionWarning(res.status)],
      };
    }

    const body = (await res.json().catch(() => null)) as unknown;
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;

    const results = Array.isArray(record?.Results)
      ? record.Results
      : Array.isArray(body)
        ? body
        : [];

    const releases = (results as Record<string, unknown>[])
      .map((raw) => this.normalizeRelease(raw))
      .filter((r): r is NormalizedRelease => r !== null);

    const indexerWarnings: IndexerWarning[] = [];
    if (Array.isArray(record?.Indexers)) {
      for (const idx of record.Indexers as Record<string, unknown>[]) {
        if (
          typeof idx === "object" &&
          idx !== null &&
          idx.Status === 1 &&
          typeof idx.Error === "string" &&
          idx.Error.trim()
        ) {
          indexerWarnings.push({
            id:
              typeof idx.ID === "string"
                ? idx.ID
                : typeof idx.Id === "string"
                  ? idx.Id
                  : "unknown",
            name:
              typeof idx.Name === "string"
                ? idx.Name
                : typeof idx.ID === "string"
                  ? idx.ID
                  : "unknown",
            error: idx.Error.trim(),
          });
        }
      }
    }

    return { releases, indexerWarnings };
  }

  /** Build a UI-visible warning for a whole-Jackett connectivity/auth failure. */
  private connectionWarning(status: number | null): IndexerWarning {
    const auth = status === 401 || status === 403;
    const error = auth
      ? `Jackett rejected the request (HTTP ${status}) — check the API key in Settings.`
      : status != null
        ? `Jackett returned HTTP ${status} — check the Jackett server.`
        : `Could not reach Jackett at ${this.config.website_url} — check that it is running and the URL is correct.`;
    return { id: "jackett-connection", name: "Jackett", error };
  }

  async getIndexers(): Promise<NormalizedIndexer[]> {
    // Use the Torznab t=indexers endpoint — returns configured indexers instantly
    // without triggering a search, so down/slow indexers can't cause a timeout.
    const url = new URL(
      "/api/v2.0/indexers/all/results/torznab/api",
      this.config.website_url,
    );
    url.searchParams.set("apikey", this.config.api_key);
    url.searchParams.set("t", "indexers");
    url.searchParams.set("configured", "true");

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    if (!res?.ok) return [];

    const text = await res.text().catch(() => null);
    if (!text) return [];

    const matches = [
      ...text.matchAll(
        /<indexer id="([^"]+)"[^>]*>\s*<title>([^<]+)<\/title>/g,
      ),
    ];
    if (matches.length === 0) return [];

    const indexers: NormalizedIndexer[] = matches.map((m, idx) => ({
      id: idx,
      slug: m[1],
      name: m[2],
      protocol: "torrent",
      enabled: true,
      privacy: "private",
    }));

    indexers.sort((a, b) => a.name.localeCompare(b.name));

    return indexers;
  }

  async fetchRss(slugs: string[]): Promise<NormalizedRelease[]> {
    const results = await Promise.all(
      slugs.map((slug) => this.fetchOneRss(slug)),
    );
    return results.flat();
  }

  private async fetchOneRss(slug: string): Promise<NormalizedRelease[]> {
    try {
      const url = new URL(
        `/api/v2.0/indexers/${slug}/results`,
        this.config.website_url,
      );
      url.searchParams.set("apikey", this.config.api_key);
      url.searchParams.append("Category[]", "2000");
      url.searchParams.append("Category[]", "5000");
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      }).catch((err: unknown) => {
        console.warn(
          `[JackettAdapter] fetchRss failed for indexer "${slug}": ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });
      if (!res) return [];
      if (!res.ok) {
        console.warn(
          `[JackettAdapter] fetchRss non-OK response for indexer "${slug}": ${res.status}`,
        );
        return [];
      }
      const body = (await res.json().catch(() => null)) as unknown;
      const record =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : null;
      const results = Array.isArray(record?.Results) ? record.Results : [];
      return (results as Record<string, unknown>[])
        .map((raw) => this.normalizeRelease(raw))
        .filter((r): r is NormalizedRelease => r !== null);
    } catch (err) {
      console.warn(
        `[JackettAdapter] fetchRss unexpected error for indexer "${slug}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  async grabRelease(token: string): Promise<GrabResult> {
    const stored = takeDownloadUrl(token);
    if (!stored) {
      return { success: false, error: "Release token expired or not found" };
    }

    if (stored.isMagnet) {
      return { success: true, magnetUrl: stored.url };
    }
    return { success: true, downloadUrl: stored.url };
  }

  storeReleaseToken(release: NormalizedRelease): string | null {
    const url = release.magnetUrl ?? release.downloadUrl;
    if (!url) return null;
    return storeDownloadUrl(url, url.startsWith("magnet:"));
  }

  private normalizeRelease(
    raw: Record<string, unknown>,
  ): NormalizedRelease | null {
    const title = toString(raw.Title) || toString(raw.title);
    const guid =
      toString(raw.Guid) || toString(raw.guid) || toString(raw.Link) || title;
    if (!guid || !title) return null;

    const magnetUrl =
      toString(raw.MagnetUri) || toString(raw.magnetUri) || null;
    const link = toString(raw.Link) || toString(raw.link) || null;
    const downloadUrl = link && !link.startsWith("magnet:") ? link : null;

    const trackerName = toString(raw.Tracker) || toString(raw.tracker) || null;

    const infoHash =
      toString(raw.InfoHash) ||
      toString(raw.infoHash) ||
      (magnetUrl ? extractInfoHash(magnetUrl) : null);

    const dvf = toNumber(raw.DownloadVolumeFactor);

    return {
      guid,
      title,
      indexer: trackerName,
      indexerId: null,
      languages: [],
      protocol: "torrent",
      sizeBytes: toNumber(raw.Size) ?? toNumber(raw.size) ?? null,
      age: null,
      seeders: toNumber(raw.Seeders) ?? toNumber(raw.seeders) ?? null,
      leechers: toNumber(raw.Peers) ?? toNumber(raw.peers) ?? null,
      rejected: false,
      rejections: [],
      infoUrl: toString(raw.Details) || toString(raw.details) || null,
      downloadUrl,
      magnetUrl,
      infoHash,
      tmdbId: toNumber(raw.TMDb) ?? toNumber(raw.tmdb) ?? null,
      freeleech: dvf === 0,
    };
  }
}

function toString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractInfoHash(magnet: string): string | null {
  const m = /btih:([a-fA-F0-9]{40})/i.exec(magnet);
  return m ? m[1].toLowerCase() : null;
}
