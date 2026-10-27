import { prisma } from "@rawkoon/api/db";
import { getActiveIndexerManager } from "@rawkoon/api/services/indexerManager/factory";
import type { NormalizedIndexer } from "@rawkoon/api/services/indexerManager/types";
import { getDownloadClientIntegrationConfig } from "@rawkoon/api/services/downloadClient/config";
import { buildAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { GrabReadinessCheck } from "@rawkoon/shared/types";

const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 8_000;

export type IndexerProbe =
  | { state: "not_configured" }
  | { state: "unreachable"; manager: string }
  | { state: "ok"; manager: string; indexers: NormalizedIndexer[] };

export type ClientProbe =
  | { state: "not_configured" }
  | { state: "unreachable"; clientType: string }
  | { state: "ok"; clientType: string };

export interface GrabReadinessInput {
  indexer: IndexerProbe;
  client: ClientProbe;
  rssIndexers: string[];
  defaultMovieProfileName: string | null;
  defaultShowProfileName: string | null;
  profilesWithoutMaximum: { id: number; name: string }[];
  searchOnAdd: boolean;
}

function profileCheck(
  id: "default_movie_profile" | "default_show_profile",
  name: string | null,
): GrabReadinessCheck {
  return name
    ? { id, status: "ok", params: { profile_name: name } }
    : { id, status: "warn", params: {} };
}

/** Pure: turns the gathered facts into the checklist, so it is testable without I/O. */
export function evaluateGrabReadiness(
  input: GrabReadinessInput,
): GrabReadinessCheck[] {
  const checks: GrabReadinessCheck[] = [];
  const { indexer, client } = input;

  if (indexer.state === "ok") {
    const enabled = indexer.indexers.filter((i) => i.enabled);
    checks.push({
      id: "indexer_manager",
      status: enabled.length === 0 ? "warn" : "ok",
      params: { manager: indexer.manager, indexers: enabled.length },
    });

    if (enabled.length > 0) {
      const slugs = enabled.map((i) => i.slug);
      const watched = input.rssIndexers.filter((s) => slugs.includes(s));
      checks.push({
        id: "rss_indexers",
        status: watched.length === 0 ? "warn" : "ok",
        params: {
          manager: indexer.manager,
          watched: watched.length,
          total: slugs.length,
          unwatched: slugs.filter((s) => !watched.includes(s)),
        },
      });
    }
  } else {
    checks.push({
      id: "indexer_manager",
      status: "error",
      params: {
        reason: indexer.state,
        ...(indexer.state === "unreachable"
          ? { manager: indexer.manager }
          : {}),
      },
    });
  }

  checks.push(
    client.state === "ok"
      ? {
          id: "download_client",
          status: "ok",
          params: { client_type: client.clientType },
        }
      : {
          id: "download_client",
          status: "error",
          params: {
            reason: client.state,
            ...(client.state === "unreachable"
              ? { client_type: client.clientType }
              : {}),
          },
        },
  );

  checks.push(
    profileCheck("default_movie_profile", input.defaultMovieProfileName),
    profileCheck("default_show_profile", input.defaultShowProfileName),
    {
      id: "profiles_without_maximum",
      status: input.profilesWithoutMaximum.length > 0 ? "warn" : "ok",
      params: { profiles: input.profilesWithoutMaximum },
    },
    {
      id: "search_on_add",
      status: "ok",
      params: { enabled: input.searchOnAdd },
    },
  );

  return checks;
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS),
    ),
  ]);
}

async function probeIndexer(): Promise<IndexerProbe> {
  const adapter = await getActiveIndexerManager();
  if (!adapter) return { state: "not_configured" };
  try {
    const indexers = await withTimeout(adapter.getIndexers());
    return { state: "ok", manager: adapter.name, indexers };
  } catch {
    return { state: "unreachable", manager: adapter.name };
  }
}

async function probeClient(): Promise<ClientProbe> {
  const { enabled, clientType, config } =
    await getDownloadClientIntegrationConfig();
  if (!enabled || !clientType || !config) return { state: "not_configured" };
  try {
    const res = await withTimeout(
      buildAdapter(clientType, config).testConnection(),
    );
    return res.ok
      ? { state: "ok", clientType }
      : { state: "unreachable", clientType };
  } catch {
    return { state: "unreachable", clientType };
  }
}

type Probes = { indexer: IndexerProbe; client: ClientProbe };

const REFRESH_MIN_INTERVAL_MS = 5_000;

let probeCache: { at: number; value: Promise<Probes> } | null = null;

/** The probes call external services, so concurrent and repeated loads share one run. */
function getProbes(): Promise<Probes> {
  const now = Date.now();
  if (probeCache && now - probeCache.at < PROBE_TTL_MS) return probeCache.value;
  const value = Promise.all([probeIndexer(), probeClient()]).then(
    ([indexer, client]) => ({ indexer, client }),
  );
  probeCache = { at: now, value };
  return value;
}

export function resetGrabReadinessProbeCache(): void {
  probeCache = null;
}

export async function getGrabReadiness(
  options: { refresh?: boolean } = {},
): Promise<GrabReadinessCheck[]> {
  // A refresh within a few seconds of the last probe reuses it, so a double-click doesn't probe twice.
  if (
    options.refresh &&
    (!probeCache || Date.now() - probeCache.at > REFRESH_MIN_INTERVAL_MS)
  )
    resetGrabReadinessProbeCache();
  const [probes, settings, profiles] = await Promise.all([
    getProbes(),
    prisma.mediaSettings.findUnique({ where: { id: 1 } }),
    prisma.qualityProfile.findMany({
      select: { id: true, name: true, cutoffResolution: true },
      orderBy: { name: "asc" },
    }),
  ]);

  let rssIndexers: string[] = [];
  if (probes.indexer.state === "ok") {
    // Read the DB, not the integration cache: a "Watch all" save must show at once.
    const row = await prisma.integration.findFirst({
      where: { type: probes.indexer.manager },
      select: { config: true },
    });
    const raw = (row?.config as Record<string, unknown> | null)?.rss_indexers;
    rssIndexers = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string")
      : [];
  }

  const nameOf = (id: number | null | undefined) =>
    profiles.find((p) => p.id === id)?.name ?? null;

  return evaluateGrabReadiness({
    ...probes,
    rssIndexers,
    defaultMovieProfileName: nameOf(settings?.defaultMovieQualityProfileId),
    defaultShowProfileName: nameOf(settings?.defaultShowQualityProfileId),
    profilesWithoutMaximum: profiles
      .filter((p) => p.cutoffResolution === null)
      .map((p) => ({ id: p.id, name: p.name })),
    searchOnAdd: settings?.searchOnAdd ?? true,
  });
}
