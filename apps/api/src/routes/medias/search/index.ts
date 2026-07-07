import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import {
  getActiveIndexerManager,
  tieredSearch,
} from "@rawkoon/api/services/indexerManager";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";
import { parseReleaseTitle } from "@rawkoon/api/utils/medias/filenameParser";
import { scoreReleaseDetailed } from "@rawkoon/api/utils/medias/releaseScorer";
import type { ScoreBreakdownDto } from "@rawkoon/shared/types";
import {
  profileToScoreInput,
  qualityProfileFormatsInclude,
} from "@rawkoon/api/services/mediaGrabberHelpers";
import {
  isSeasonPack,
  isCompleteSeries,
} from "@rawkoon/api/utils/medias/mappers";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeLocalAiConfig } from "@rawkoon/api/utils/integrations/normalizers";
import {
  loadEnabledLocalAiConfig,
  pickReleaseWithLocalAi,
} from "@rawkoon/api/services/localAi/client";

function normalizedToInteractive(
  r: NormalizedRelease,
  source: "prowlarr" | "jackett",
  downloadToken: string | null,
): InteractiveReleaseItem {
  return {
    guid: r.guid,
    title: r.title,
    indexer: r.indexer,
    indexer_id: r.indexerId,
    languages: r.languages,
    protocol: r.protocol,
    size_bytes: r.sizeBytes,
    age: r.age,
    seeders: r.seeders,
    leechers: r.leechers,
    rejected: r.rejected,
    rejection_reason: r.rejections.length > 0 ? r.rejections.join(", ") : null,
    info_url: r.infoUrl,
    source,
    download_token: downloadToken,
    download_url: r.magnetUrl ?? r.downloadUrl ?? null,
    is_season_pack: isSeasonPack(r.title),
    is_complete_series: isCompleteSeries(r.title),
    freeleech: r.freeleech || undefined,
  };
}

let warmInFlight = false;

export const mediasSearchRoutes = new Elysia()
  .use(auth)
  .use(requireAdmin)
  .get(
    "/interactive-search",
    async ({ set, query }) => {
      // Strip diacritics and colons before querying indexers: release names are
      // almost always ASCII, and colons can be parsed as field separators by some
      // tracker search engines (e.g. Elasticsearch-backed private trackers).
      const searchQuery = query.q
        .trim()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .replace(/:/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const seasonNumber =
        query.season != null ? parseInt(String(query.season), 10) : null;
      const tmdbId =
        query.tmdb_id != null ? parseInt(String(query.tmdb_id), 10) : null;
      const isSeasonSearch =
        seasonNumber != null && Number.isFinite(seasonNumber);
      const isCompleteSearch =
        query.complete === "true" || query.complete === true;

      if (!isSeasonSearch && !isCompleteSearch && searchQuery.length < 2) {
        return badRequest(
          set,
          "Search query must be at least 2 characters long",
        );
      }

      try {
        const adapter = await getActiveIndexerManager();
        if (!adapter) {
          return badRequest(
            set,
            "No indexer manager configured. Enable Prowlarr or Jackett in integration settings.",
          );
        }

        // Determine media type for category filtering
        const mediaType: "movie" | "tv" | undefined =
          isSeasonSearch || isCompleteSearch
            ? "tv"
            : query.media_type === "movie" || query.media_type === "tv"
              ? query.media_type
              : undefined;

        const { releases: searchedReleases, indexerWarnings } =
          await tieredSearch(adapter, {
            query: searchQuery,
            tmdbId,
            season: isSeasonSearch ? seasonNumber : null,
            complete: isCompleteSearch,
            mediaType,
          });

        // TMDb ID validation: when tmdbId is provided, filter out results
        // where the indexer reports a different tmdbId (keep results with no tmdbId)
        const rawReleases =
          tmdbId != null
            ? searchedReleases.filter(
                (r) => r.tmdbId == null || r.tmdbId === tmdbId,
              )
            : searchedReleases;

        let mapped: InteractiveReleaseItem[] = rawReleases.map((r) => {
          const downloadToken = adapter.storeReleaseToken(r);
          return normalizedToInteractive(r, adapter.name, downloadToken);
        });

        const lmRaw = query.library_media_id;
        if (lmRaw != null && lmRaw !== "") {
          const libId =
            typeof lmRaw === "number" ? lmRaw : parseInt(String(lmRaw), 10);
          if (Number.isFinite(libId)) {
            const media = await prisma.libraryMedia.findUnique({
              where: { id: libId },
              include: {
                qualityProfile: { include: qualityProfileFormatsInclude },
              },
            });
            const qp = media?.qualityProfile;
            if (qp) {
              const profile = profileToScoreInput(qp);
              mapped = mapped.map((r) => {
                const parsed = parseReleaseTitle(r.title);
                const breakdown = scoreReleaseDetailed(
                  {
                    parsed,
                    rawTitle: r.title,
                    sizeBytes: r.size_bytes,
                    indexerName: r.indexer,
                    seeders: r.seeders,
                    freeleech: Boolean(r.freeleech),
                  },
                  profile,
                );
                const qualityReject = breakdown.rejected;
                const parsed_quality = {
                  resolution: parsed.resolution,
                  source: parsed.source,
                  codec: parsed.codec,
                  hdr: parsed.hdr,
                };
                const rejected = r.rejected || qualityReject;
                let rejection_reason = r.rejection_reason;
                if (qualityReject) {
                  const qmsg = breakdown.reasons.map((x) => x.code).join(", ");
                  rejection_reason = rejection_reason
                    ? `${rejection_reason}; ${qmsg}`
                    : qmsg;
                }
                const score_breakdown: ScoreBreakdownDto = breakdown.rejected
                  ? {
                      rejected: true,
                      total: null,
                      components: [],
                      matched_formats: [],
                    }
                  : {
                      rejected: false,
                      total: breakdown.total,
                      components: breakdown.components.map((c) => ({
                        code: c.code,
                        value: c.value,
                        ...(c.params ? { params: c.params } : {}),
                      })),
                      matched_formats: breakdown.matchedFormats,
                    };
                return {
                  ...r,
                  quality_score: qualityReject ? null : breakdown.total,
                  quality_rejection_reasons: qualityReject
                    ? breakdown.reasons.map((x) => x.code)
                    : null,
                  parsed_quality,
                  rejected,
                  rejection_reason,
                  score_breakdown,
                };
              });
              mapped.sort((a, b) => {
                const ar = a.rejected ? 1 : 0;
                const br = b.rejected ? 1 : 0;
                if (ar !== br) return ar - br;
                const as = a.quality_score ?? -Number.MAX_SAFE_INTEGER;
                const bs = b.quality_score ?? -Number.MAX_SAFE_INTEGER;
                if (as !== bs) return bs - as;
                return a.title.localeCompare(b.title);
              });
            }
          }
        }

        return {
          success: true,
          service: adapter.name,
          releases: mapped,
          ...(indexerWarnings.length > 0
            ? { indexer_warnings: indexerWarnings }
            : {}),
        };
      } catch (error) {
        console.error("Error loading interactive search releases:", error);
        return serverError(set, "Failed to load interactive search releases");
      }
    },
    {
      query: t.Object({
        q: t.String(),
        library_media_id: t.Optional(t.Union([t.String(), t.Number()])),
        season: t.Optional(t.Union([t.String(), t.Number()])),
        tmdb_id: t.Optional(t.Union([t.String(), t.Number()])),
        complete: t.Optional(t.Union([t.String(), t.Boolean()])),
        media_type: t.Optional(t.Union([t.Literal("movie"), t.Literal("tv")])),
      }),
    },
  )
  .get("/indexers", async ({ set }) => {
    try {
      const adapter = await getActiveIndexerManager();
      if (!adapter) {
        return badRequest(
          set,
          "No indexer manager configured. Enable Prowlarr or Jackett in integration settings.",
        );
      }
      const indexers = await adapter.getIndexers();
      return { indexers };
    } catch {
      return serverError(set, "Failed to fetch indexers");
    }
  })
  .post(
    "/interactive-search/download",
    async ({ set, body }) => {
      const token = body.token.trim();
      if (!token) {
        return badRequest(set, "Invalid release token");
      }

      try {
        const adapter = await getActiveIndexerManager();
        if (!adapter) {
          return badRequest(
            set,
            "No indexer manager configured. Enable Prowlarr or Jackett in integration settings.",
          );
        }

        const result = await adapter.grabRelease(token);
        if (!result.success) {
          return notFound(
            set,
            result.error ??
              "Selected release is no longer available. Run the search again.",
          );
        }

        return {
          success: true,
          service: adapter.name,
          ...(result.downloadUrl ? { download_url: result.downloadUrl } : {}),
          ...(result.magnetUrl ? { magnet_url: result.magnetUrl } : {}),
        };
      } catch (error) {
        console.error("Error downloading release:", error);
        return serverError(set, "Failed to download release");
      }
    },
    {
      body: t.Object({
        token: t.String(),
      }),
    },
  )
  .post(
    "/search/ai-pick",
    async ({ body, set }) => {
      const config = await loadEnabledLocalAiConfig();

      if (!config) {
        set.status = 404;
        return { error: "Local AI integration not configured or disabled" };
      }

      if (body.releases.length === 0) {
        set.status = 422;
        return { error: "No releases to analyze" };
      }

      const result = await pickReleaseWithLocalAi(
        config,
        body.media_context,
        body.releases,
      );
      if (!result) {
        set.status = 502;
        return { error: "Could not get response from AI" };
      }

      return result;
    },
    {
      body: t.Object({
        media_context: t.Object({
          title: t.String(),
          year: t.Nullable(t.Number()),
          type: t.Union([t.Literal("movie"), t.Literal("tv")]),
        }),
        releases: t.Array(
          t.Object({
            key: t.String(),
            title: t.String(),
            size_bytes: t.Nullable(t.Number()),
            seeders: t.Nullable(t.Number()),
            score: t.Nullable(t.Number()),
          }),
        ),
      }),
    },
  )
  .get("/search/ai-warm", async ({ set }) => {
    const record = await getIntegrationConfigRecord("local-ai");
    const config = normalizeLocalAiConfig(record?.config);

    if (!record?.enabled || !config) {
      set.status = 204;
      return;
    }

    if (warmInFlight) {
      set.status = 204;
      return;
    }

    // Fire-and-forget: loads the model into VRAM without blocking the caller.
    warmInFlight = true;
    void fetch(`${config.base_url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(10_000),
    })
      .catch(() => {})
      .finally(() => {
        warmInFlight = false;
      });

    set.status = 204;
  });
