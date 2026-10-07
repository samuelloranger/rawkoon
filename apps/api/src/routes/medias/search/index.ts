import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
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
import {
  badGateway,
  badRequest,
  conflict,
  notFound,
  ok,
  serverError,
  tooManyRequests,
  unprocessable,
} from "@rawkoon/api/errors";
import { gateAiCall } from "@rawkoon/api/services/aiProvider/aiGate";
import { grabRelease } from "@rawkoon/api/services/mediaGrabberGrab";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeAiProviderConfig } from "@rawkoon/api/utils/integrations/normalizers";
import {
  loadEnabledAiProviderConfig,
  pickReleaseWithAi,
} from "@rawkoon/api/services/aiProvider/client";

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

export type InteractiveSearchDownloadBody = {
  token: string;
  library_media_id?: number;
  episode_id?: number;
  season?: number;
  is_upgrade?: boolean;
};

/** Resolve a search token and enqueue via grabRelease(); 409 if no library item. */
export async function downloadInteractiveSearchRelease(
  body: InteractiveSearchDownloadBody,
  set: { status?: number | string },
) {
  const token = body.token.trim();
  if (!token) {
    return badRequest("Invalid release token");
  }

  try {
    const adapter = await getActiveIndexerManager();
    if (!adapter) {
      return badRequest(
        "No indexer manager configured. Enable Prowlarr or Jackett in integration settings.",
      );
    }

    // Pop the token first so a retry cannot double-grab the same payload.
    const resolved = await adapter.grabRelease(token);
    if (!resolved.success) {
      return notFound(
        resolved.error ??
          "Selected release is no longer available. Run the search again.",
      );
    }

    const downloadUrl = resolved.magnetUrl ?? resolved.downloadUrl;
    if (!downloadUrl) {
      return badRequest("Release has no download URL");
    }
    const releaseTitle = resolved.title?.trim();
    if (!releaseTitle) {
      return badRequest("Release has no title");
    }

    let mediaId = body.library_media_id;
    if (mediaId == null && body.episode_id != null) {
      const episode = await prisma.libraryEpisode.findUnique({
        where: { id: body.episode_id },
        select: { mediaId: true },
      });
      mediaId = episode?.mediaId;
    }
    if (mediaId == null) {
      return conflict(
        "No library item to attach this download to. Add the title to your library first.",
      );
    }
    const media = await prisma.libraryMedia.findUnique({
      where: { id: mediaId },
      select: { id: true },
    });
    if (!media) {
      return conflict(
        "No library item to attach this download to. Add the title to your library first.",
      );
    }

    const result = await grabRelease({
      mediaId,
      episodeId: body.episode_id,
      season: body.season,
      downloadUrl,
      releaseTitle,
      indexer: resolved.indexer,
      isUpgrade: body.is_upgrade ?? false,
    });

    if (result.grabbed) {
      return {
        grabbed: true,
        release_title: result.releaseTitle,
        service: adapter.name,
      };
    }
    return { grabbed: false, reason: result.reason };
  } catch (error) {
    console.error("Error downloading release:", error);
    return serverError("Failed to download release");
  }
}

const interactiveSearchQuery = z.object({
  q: z.string(),
  library_media_id: z.union([z.string(), z.number()]).optional(),
  season: z.union([z.string(), z.number()]).optional(),
  tmdb_id: z.union([z.string(), z.number()]).optional(),
  complete: z.union([z.string(), z.boolean()]).optional(),
  media_type: z.union([z.literal("movie"), z.literal("tv")]).optional(),
});

// Swift's synthesized Encodable omits nil optionals rather than sending null.
const nullableNumber = z.number().nullable().default(null);

export const aiPickBodySchema = z.object({
  media_id: z.number().int().optional(),
  media_context: z.object({
    title: z.string(),
    year: nullableNumber,
    type: z.union([z.literal("movie"), z.literal("tv")]),
    season: nullableNumber.optional(),
    episode: nullableNumber.optional(),
  }),
  releases: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      size_bytes: nullableNumber,
      seeders: nullableNumber,
      score: nullableNumber,
    }),
  ),
});

export async function handleAiPick(
  body: z.infer<typeof aiPickBodySchema>,
): Promise<Response> {
  const config = await loadEnabledAiProviderConfig();

  if (!config) {
    return notFound("AI Provider integration not configured or disabled");
  }

  if (body.releases.length === 0) {
    return unprocessable("No releases to analyze");
  }

  const ctx = {
    feature: "release_pick_interactive" as const,
    trigger: "interactive" as const,
    mediaId: body.media_id,
  };
  // Checked here too so the client can tell "off" and "budget spent" apart from a failed call.
  const gate = await gateAiCall(config, ctx);
  if (!gate.allowed) {
    return gate.reason === "feature_disabled"
      ? notFound("AI Provider integration not configured or disabled")
      : tooManyRequests("AI daily budget reached");
  }

  // Languages come from the media's own profile, as in the automatic grab.
  let preferredLanguages: string[] = [];
  if (body.media_id != null) {
    const media = await prisma.libraryMedia.findUnique({
      where: { id: body.media_id },
      include: { qualityProfile: { include: qualityProfileFormatsInclude } },
    });
    if (media?.qualityProfile) {
      preferredLanguages = profileToScoreInput(
        media.qualityProfile,
      ).preferredLanguages;
    }
  }

  const result = await pickReleaseWithAi(
    config,
    {
      ...body.media_context,
      ...(preferredLanguages.length > 0
        ? { preferred_languages: preferredLanguages }
        : {}),
    },
    body.releases,
    ctx,
  );
  if (!result) {
    return badGateway("Could not get response from AI");
  }

  return ok(result);
}

// Mounted at /api/medias by the medias parent; admin-only.
export const mediasSearchRoutes = new Hono<Env>()
  .get(
    "/interactive-search",
    requireAdmin,
    queryV(interactiveSearchQuery),
    async (c) => {
      const query = c.req.valid("query");
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
        return badRequest("Search query must be at least 2 characters long");
      }

      try {
        const adapter = await getActiveIndexerManager();
        if (!adapter) {
          return badRequest(
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

        return ok({
          success: true,
          service: adapter.name,
          releases: mapped,
          ...(indexerWarnings.length > 0
            ? { indexer_warnings: indexerWarnings }
            : {}),
        });
      } catch (error) {
        console.error("Error loading interactive search releases:", error);
        return serverError("Failed to load interactive search releases");
      }
    },
  )
  .get("/indexers", requireAdmin, async () => {
    try {
      const adapter = await getActiveIndexerManager();
      if (!adapter) {
        return badRequest(
          "No indexer manager configured. Enable Prowlarr or Jackett in integration settings.",
        );
      }
      const indexers = await adapter.getIndexers();
      return ok({ indexers });
    } catch {
      return serverError("Failed to fetch indexers");
    }
  })
  .post(
    "/interactive-search/download",
    requireAdmin,
    jsonV(
      z.object({
        token: z.string(),
        library_media_id: z.number().optional(),
        episode_id: z.number().optional(),
        season: z.number().optional(),
        is_upgrade: z.boolean().optional(),
      }),
    ),
    async (c) => {
      // downloadInteractiveSearchRelease returns a Web Response on error and a
      // plain object on success — wrap only the plain object at the route.
      const result = await downloadInteractiveSearchRelease(
        c.req.valid("json"),
        {},
      );
      return result instanceof Response ? result : ok(result);
    },
  )
  .post("/search/ai-pick", requireAdmin, jsonV(aiPickBodySchema), async (c) =>
    handleAiPick(c.req.valid("json")),
  )
  .get("/search/ai-warm", requireAdmin, async () => {
    const record = await getIntegrationConfigRecord("ai-provider");
    const config = normalizeAiProviderConfig(record?.config);

    if (!record?.enabled || !config) {
      return new Response(null, { status: 204 });
    }

    if (warmInFlight) {
      return new Response(null, { status: 204 });
    }

    // Fire-and-forget: loads the model into VRAM without blocking the caller.
    warmInFlight = true;
    void fetch(`${config.base_url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.api_key
          ? { Authorization: `Bearer ${config.api_key}` }
          : {}),
      },
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

    return new Response(null, { status: 204 });
  });
