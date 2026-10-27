import { Hono } from "hono";
import { z } from "zod";
import {
  badRequest,
  notFound,
  ok,
  serverError,
  serviceUnavailable,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV, queryV } from "@rawkoon/api/middleware/validate";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import { loadJanitorStats } from "@rawkoon/api/services/downloadsApi/janitorStats";
import {
  listPendingReleaseItems,
  releaseHeldTarget,
} from "@rawkoon/api/services/downloadsApi/pendingReleases";
import {
  deleteSeedRules,
  loadSeedRuleRows,
  saveSeedRule,
} from "@rawkoon/api/services/downloadsApi/seedRules";
import { loadSeedingView } from "@rawkoon/api/services/downloadsApi/seedingList";
import {
  loadOwnedHashes,
  loadOwnedRowIds,
  removeOrphanTorrents,
} from "@rawkoon/api/services/seeding/orphans";
import {
  indexerKey,
  taggedRowIds,
} from "@rawkoon/api/services/seeding/seedPolicy";
import {
  defaultSweepDeps,
  loadSeedContext,
  previewSeedRelease,
  releaseTorrentNow,
} from "@rawkoon/api/services/seeding/seedSweep";
import {
  buildOrphans,
  buildSeedRuleRows,
  buildSeedingTorrents,
  supersededIds,
} from "@rawkoon/api/services/seeding/seedingView";
import { processPendingReleases } from "@rawkoon/api/workers/processPendingReleases";

async function listClientTorrents(): Promise<NormalizedTorrent[] | null> {
  const active = await resolveActiveAdapter();
  if (!active) return [];
  return active.adapter.listTorrents().catch(() => null);
}

/** Shapes produced by grabDelay.targetKey: movie, season pack or episode. */
const TARGET_KEY_PATTERN = /^(m:\d+|s:\d+:\d+|e:\d+)$/;

const hashParam = z.object({ hash: z.string().regex(/^[0-9a-fA-F]{40}$/) });
const indexerParam = z.object({ indexer: z.string().min(1).max(200) });
const ruleBody = z.object({
  ratio: z.number().min(0).max(100).nullable(),
  seed_time_mins: z.number().int().min(0).max(525_600).nullable(),
});

// Mounted at /api/downloads. Every route guards itself: a .use('*') guard leaks across .route() merges.
export const downloadsRoutes = new Hono<Env>()
  .get(
    "/seeding",
    requireAdmin,
    queryV(z.object({ preview: z.string().optional() })),
    async (c) => {
      try {
        const torrents = await listClientTorrents();
        if (torrents === null)
          return serviceUnavailable("Download client is unreachable");
        const view = await loadSeedingView(
          torrents,
          c.req.valid("query").preview === "1",
        );
        return ok(view);
      } catch (e) {
        console.error("[downloads] seeding list failed:", e);
        return serverError("Failed to load seeding torrents");
      }
    },
  )
  .post(
    "/seeding/:hash/release",
    requireAdmin,
    paramV(hashParam),
    async (c) => {
      try {
        const result = await releaseTorrentNow(c.req.valid("param").hash);
        switch (result.status) {
          case "released":
            return ok({ released: true, freed_bytes: result.freedBytes });
          case "pending":
            return badRequest("Torrent is still downloading");
          case "adopted":
            return badRequest(
              "Rawkoon did not add this torrent; remove it in your download client",
            );
          case "unavailable":
            return serviceUnavailable(
              "Download client is not configured or unreachable",
            );
          default:
            return notFound("No seeding torrent with that hash");
        }
      } catch (e) {
        console.error("[downloads] release failed:", e);
        return serverError("Failed to remove torrent");
      }
    },
  )
  .get("/orphans", requireAdmin, async () => {
    try {
      const torrents = await listClientTorrents();
      if (torrents === null)
        return serviceUnavailable("Download client is unreachable");
      return ok(
        buildOrphans(
          torrents,
          await loadOwnedHashes(),
          await loadOwnedRowIds(torrents.flatMap(taggedRowIds)),
        ),
      );
    } catch {
      return serverError("Failed to load orphaned torrents");
    }
  })
  .post(
    "/orphans/remove",
    requireAdmin,
    jsonV(
      z.object({
        hashes: z
          .array(z.string().regex(/^[0-9a-fA-F]{40}$/))
          .min(1)
          .max(500),
        delete_data: z.boolean(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const result = await removeOrphanTorrents(
          body.hashes,
          body.delete_data,
        );
        if (!result)
          return serviceUnavailable(
            "Download client is not configured or unreachable",
          );
        return ok(result);
      } catch {
        return serverError("Failed to remove orphaned torrents");
      }
    },
  )
  .get("/seed-rules", requireAdmin, async () => {
    try {
      return ok({ indexers: await loadSeedRuleRows() });
    } catch {
      return serverError("Failed to load seed rules");
    }
  })
  .put(
    "/seed-rules/:indexer",
    requireAdmin,
    paramV(indexerParam),
    jsonV(ruleBody),
    async (c) => {
      const name = c.req.valid("param").indexer.trim();
      const body = c.req.valid("json");
      try {
        const rule = await saveSeedRule(name, body);
        return ok({
          rule: {
            indexer: rule.indexerName,
            ratio: rule.ratio,
            seed_time_mins: rule.seedTimeMins,
          },
        });
      } catch {
        return serverError("Failed to save seed rule");
      }
    },
  )
  .delete(
    "/seed-rules/:indexer",
    requireAdmin,
    paramV(indexerParam),
    async (c) => {
      const name = c.req.valid("param").indexer.trim();
      try {
        return ok({ deleted: await deleteSeedRules(name) });
      } catch {
        return serverError("Failed to delete seed rule");
      }
    },
  )
  .get("/pending-releases", requireAdmin, async () => {
    try {
      return ok({ items: await listPendingReleaseItems() });
    } catch {
      return serverError("Failed to load pending releases");
    }
  })
  .post(
    "/pending-releases/grab-now",
    requireAdmin,
    jsonV(z.object({ target_key: z.string().regex(TARGET_KEY_PATTERN) })),
    async (c) => {
      const { target_key } = c.req.valid("json");
      try {
        // Pull the window forward, then replay the normal due-target pass for this target only.
        const moved = await releaseHeldTarget(target_key);
        if (moved === 0) return notFound("No held release for that target");
        const { grabbed, reason } = await processPendingReleases(
          new Date(),
          target_key,
        );
        return ok({
          grabbed: grabbed > 0,
          reason: grabbed > 0 ? null : reason,
        });
      } catch (e) {
        console.error("[downloads] grab-now failed:", e);
        return serverError("Failed to grab the held release");
      }
    },
  )
  .get("/janitor-stats", requireAdmin, async () => {
    try {
      return ok(await loadJanitorStats());
    } catch {
      return serverError("Failed to load janitor stats");
    }
  });
