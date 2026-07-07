import { Elysia } from "elysia";
import { prisma } from "@rawkoon/api/db";
import { badRequest, forbidden, serverError } from "@rawkoon/api/errors";
import { timingSafeEqual } from "node:crypto";
import { completeDownloadByHash } from "@rawkoon/api/workers/checkDownloadCompletion";
import { enqueueLibraryPostProcess } from "@rawkoon/api/services/postProcessorQueue";
import { qbFetchJson } from "@rawkoon/api/services/qbittorrent/clientFetch";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
import {
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import {
  QBIT_CATEGORY_RAWKOON_MOVIES,
  QBIT_CATEGORY_RAWKOON_SHOWS,
} from "@rawkoon/api/constants/libraryGrab";

export const webhooksRoutes = new Elysia({ prefix: "/api/webhooks" })
  // ── qBittorrent torrent-completion webhook ──────────────────────────────────
  // The "Configure Webhooks" button in Settings auto-configures qBittorrent to
  // call this endpoint via:
  //
  //   /usr/bin/curl -s -X POST "<rawkoon-url>/api/webhooks/qbittorrent/completed?hash=%I" \
  //     -H "Authorization: Bearer <secret>"
  //
  // qBittorrent substitutes %I with the torrent info-hash before spawning curl.
  // The hash is read from the query string; a JSON body ({ "hash": "..." }) is
  // also accepted as a fallback for manual/scripted calls.
  //
  // Use the internal Docker hostname (e.g. http://rawkoon:3000) so qBittorrent
  // (inside a VPN network_mode container) reaches Rawkoon directly without going
  // through the VPN tunnel or Cloudflare.
  .post("/qbittorrent/completed", async ({ body, query, request, set }) => {
    const qb = await getQbittorrentIntegrationConfig();
    const secret = qb.config?.webhook_secret;
    if (!secret) return forbidden(set, "Webhook not configured");

    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);
    if (
      tokenBuf.length !== secretBuf.length ||
      !timingSafeEqual(tokenBuf, secretBuf)
    ) {
      return forbidden(set, "Invalid token");
    }

    // hash may come from the query string (?hash=%I, set by autorun-setup)
    // or from a JSON body for manual/scripted calls
    let hash: string | undefined =
      typeof query?.hash === "string" ? query.hash : undefined;
    if (!hash) {
      try {
        const obj =
          body !== null && typeof body === "object"
            ? (body as Record<string, unknown>)
            : JSON.parse(typeof body === "string" ? body : "{}");
        hash = typeof obj?.hash === "string" ? obj.hash : undefined;
      } catch {
        return badRequest(set, "Invalid JSON");
      }
    }
    if (!hash?.trim()) return badRequest(set, "Missing hash");

    const downloadHistoryId = await completeDownloadByHash(hash);
    if (downloadHistoryId != null) {
      enqueueLibraryPostProcess(downloadHistoryId);
    }
    return {
      matched: downloadHistoryId != null,
      download_history_id: downloadHistoryId,
    };
  })
  // ── qBittorrent torrent-added webhook ────────────────────────────────────────
  // Auto-configured by "Configure Webhooks" in Settings — same curl/?hash=%I
  // pattern as /completed above.
  //
  // When a torrent lands in the rawkoon-movies or rawkoon-shows category, Rawkoon
  // matches it against the library by title and creates a DownloadHistory entry
  // so the item's status switches to "downloading" immediately.
  .post("/qbittorrent/added", async ({ body, query, request, set }) => {
    const qb = await getQbittorrentIntegrationConfig();
    const secret = qb.config?.webhook_secret;
    if (!secret) return forbidden(set, "Webhook not configured");

    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);
    if (
      tokenBuf.length !== secretBuf.length ||
      !timingSafeEqual(tokenBuf, secretBuf)
    ) {
      return forbidden(set, "Invalid token");
    }

    let hash: string | undefined =
      typeof query?.hash === "string" ? query.hash : undefined;
    if (!hash) {
      try {
        const obj =
          body !== null && typeof body === "object"
            ? (body as Record<string, unknown>)
            : JSON.parse(typeof body === "string" ? body : "{}");
        hash = typeof obj?.hash === "string" ? obj.hash : undefined;
      } catch {
        return badRequest(set, "Invalid JSON");
      }
    }
    if (!hash?.trim()) return badRequest(set, "Missing hash");

    const normalizedHash = hash.trim().toLowerCase();

    try {
      if (!qb.enabled || !qb.config) {
        return { matched: false, reason: "qBittorrent not configured" };
      }

      // Fetch torrent info from qBittorrent by hash
      const info = await qbFetchJson<unknown[]>(
        qb.config,
        `/api/v2/torrents/info?hashes=${normalizedHash}`,
      );
      if (!Array.isArray(info) || info.length === 0) {
        return { matched: false, reason: "Torrent not found in qBittorrent" };
      }

      const raw = info[0] as Record<string, unknown>;
      const category = typeof raw.category === "string" ? raw.category : "";
      const tags =
        typeof raw.tags === "string"
          ? raw.tags.split(",").map((t: string) => t.trim().toLowerCase())
          : [];

      const isRawkoonMedia =
        category === QBIT_CATEGORY_RAWKOON_MOVIES ||
        category === QBIT_CATEGORY_RAWKOON_SHOWS ||
        tags.includes("rawkoon");

      if (!isRawkoonMedia) {
        return { matched: false, reason: "Not a Rawkoon media torrent" };
      }

      const expectedType =
        category === QBIT_CATEGORY_RAWKOON_SHOWS ? "show" : "movie";
      const torrentName = typeof raw.name === "string" ? raw.name : "";
      if (!torrentName) {
        return { matched: false, reason: "Torrent has no name" };
      }

      // Check if already tracked
      const existing = await prisma.downloadHistory.findFirst({
        where: { torrentHash: normalizedHash },
      });
      if (existing) {
        return {
          matched: true,
          reason: "Already tracked",
          download_history_id: existing.id,
        };
      }

      // Title-match against library
      const normalize = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const normTorrent = normalize(torrentName);

      // For shows we don't filter by status: an ongoing series flips to
      // `downloaded` after its first episode lands, but new episodes still
      // need to be tracked when their torrents are added.
      const candidates = await prisma.libraryMedia.findMany({
        where: {
          type: expectedType,
          ...(expectedType === "movie"
            ? { status: { in: ["wanted", "downloading"] } }
            : {}),
        },
        select: { id: true, title: true, status: true, qualityProfileId: true },
      });

      const torrentWords = normTorrent.split(" ").filter(Boolean);
      const findWordSequenceMatch = (
        pool: Array<{ id: number; title: string; status: string }>,
      ) =>
        pool.find((m) => {
          const titleWords = normalize(m.title).split(" ").filter(Boolean);
          if (titleWords.length === 0) return false;
          // Require the title to appear as a contiguous, word-aligned sequence
          // inside the torrent name. Pure word-set containment ("the boys" ⊆
          // any torrent that has both words) produces false positives for short
          // titles like "It" or "Us" and for partial matches like "The Boys" →
          // "The Boys of Summer S01E01".
          for (let i = 0; i <= torrentWords.length - titleWords.length; i++) {
            if (
              torrentWords.slice(i, i + titleWords.length).join(" ") ===
              titleWords.join(" ")
            ) {
              return true;
            }
          }
          return false;
        });

      // When multiple shows match (e.g. "Severance" and "Severance Live"),
      // prefer an actively-tracked one over a `downloaded` one. This keeps
      // the looser show filter from amplifying cross-title collisions.
      const match =
        findWordSequenceMatch(
          candidates.filter(
            (m) => m.status === "wanted" || m.status === "downloading",
          ),
        ) ?? findWordSequenceMatch(candidates);

      if (!match) {
        console.log(
          `[qbt/added] No library match for "${torrentName}" (${normalizedHash})`,
        );
        return { matched: false, reason: "No matching library item found" };
      }

      const parsed = parseReleaseTitle(torrentName);
      let dh;
      try {
        dh = await prisma.downloadHistory.create({
          data: {
            mediaId: match.id,
            releaseTitle: torrentName,
            torrentHash: normalizedHash,
            qualityParsed: {
              resolution: parsed.resolution,
              source: parsed.source,
              codec: parsed.codec,
              hdr: parsed.hdr,
            },
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          const existingAfterRace = await prisma.downloadHistory.findFirst({
            where: { torrentHash: normalizedHash },
          });
          if (existingAfterRace) {
            return {
              matched: true,
              reason: "Already tracked",
              download_history_id: existingAfterRace.id,
            };
          }
        }
        throw error;
      }

      await prisma.libraryMedia.update({
        where: { id: match.id },
        data: { status: "downloading" },
      });

      // For shows, mark the matching episode(s) as downloading.
      // Narrow the flip to what the release actually delivers — by season,
      // and by episode number when parseable — so unrelated `wanted` rows
      // on the same show aren't lied about while this torrent lands.
      // Falls back to the broader season/show flip when SxxExx isn't
      // parseable from the release name (rare; e.g. cryptic torrent names).
      if (expectedType === "show") {
        const se = parseReleaseSeasonEpisode(torrentName);
        const episodeWhere: {
          mediaId: number;
          status: string;
          season?: number;
          episode?: number;
        } = { mediaId: match.id, status: "wanted" };
        if (se) {
          episodeWhere.season = se.season;
          if (se.episode != null) episodeWhere.episode = se.episode;
        }
        await prisma.libraryEpisode.updateMany({
          where: episodeWhere,
          data: { status: "downloading" },
        });
      }

      console.log(
        `[qbt/added] Linked "${torrentName}" (${normalizedHash}) → library item ${match.id} "${match.title}"`,
      );

      return { matched: true, download_history_id: dh.id };
    } catch (e) {
      console.error("[qbt/added] Error:", e);
      return serverError(set, "Failed to process torrent-added webhook");
    }
  });
