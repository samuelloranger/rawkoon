import { Hono } from "hono";
import { z } from "zod";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import type { ShelfMediaType } from "@rawkoon/shared/types";
import {
  addShelfEntry,
  removeShelfEntry,
  reorderShelfEntries,
  shelvesForTitle,
} from "@rawkoon/api/services/shelves/shelfEntries";
import {
  createShelf,
  deleteShelf,
  getShelfDetail,
  listShelves,
  reorderShelves,
  seedSummaries,
  setShelfCoverFile,
  updateShelf,
} from "@rawkoon/api/services/shelves/shelfService";
import { saveShelfCover } from "@rawkoon/api/services/shelves/shelfCoverService";
import {
  fetchShelfBackdropCandidates,
  fetchShelfTmdbKey,
} from "@rawkoon/api/services/shelves/shelfTmdb";
import { seedLanguage } from "@rawkoon/api/services/shelves/seeds";
import { isValidMmdd } from "@rawkoon/api/services/shelves/shelfVisibility";

const orderModeV = z.enum(["manual", "release", "rating", "added"]);
const coverStyleV = z.enum(["mosaic", "backdrop", "upload"]);
const mediaTypeV = z.enum(["movie", "show"]);

const mmddV = z
  .string()
  .regex(/^\d{2}-\d{2}$/, "Expected MM-DD")
  .refine(isValidMmdd, "Invalid month-day");

const coverFields = {
  cover_style: coverStyleV.optional(),
  cover_tmdb_id: z.number().int().positive().nullish(),
  cover_type: mediaTypeV.nullish(),
};

const shelfBody = {
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  order_mode: orderModeV.optional(),
  ...coverFields,
  home_row: z.boolean().optional(),
  visible_from: mmddV.nullish(),
  visible_to: mmddV.nullish(),
};

/** A cover title is a TMDB id and the kind it belongs to: the same number can be a movie or a show. */
const coverTitleRefine = {
  message: "A cover title needs its type",
  test: (body: { cover_tmdb_id?: number | null; cover_type?: string | null }) =>
    body.cover_tmdb_id == null || body.cover_type != null,
};

const createBody = z
  .object({ ...shelfBody, seed: z.string().min(1).max(40).optional() })
  .refine((body) => !!body.seed || !!body.name, {
    message: "A name or a seed is required",
  })
  .refine(coverTitleRefine.test, { message: coverTitleRefine.message });

const updateBody = z
  .object(shelfBody)
  .refine(coverTitleRefine.test, { message: coverTitleRefine.message });

const addEntryBody = z.object({
  tmdb_id: z.number().int().positive(),
  type: mediaTypeV,
  season: z.number().int().positive().nullish(),
  position: z.number().int().nonnegative().optional(),
  group_label: z.string().max(80).nullish(),
});

const moveEntriesBody = z.object({
  entries: z
    .array(
      z.object({
        id: z.number().int().positive(),
        position: z.number().int().nonnegative(),
        group_label: z.string().max(80).nullish(),
      }),
    )
    .min(1),
});

const orderBody = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

const seedsQuery = z.object({ lang: z.string().optional() });
const listQuery = z.object({ all: z.string().optional() });
const forTitleQuery = z.object({
  tmdb_id: z.coerce.number().int().positive(),
  type: mediaTypeV,
});

const pathId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const isFlag = (value: string | undefined) => value === "1" || value === "true";

/** The scheme and host the caller used: an uploaded cover is served back from there. */
const originOf = (url: string) => new URL(url).origin;

const coverError = (reason: string) =>
  reason === "too_large"
    ? "The image is larger than 5 MB"
    : reason === "invalid_type"
      ? "Only PNG, JPEG, GIF and WebP images are accepted"
      : reason === "not_an_image"
        ? "That file is not an image"
        : "The image could not be saved";

// Mounted at /api/shelves by the edge. Every signed-in user reads; only admins write.
export const shelfRoutes = new Hono<Env>()
  .use("*", requireUser)
  // GET /api/shelves — shelves in their window right now; admins may ask for all
  .get("/", queryV(listQuery), async (c) => {
    const user = c.get("user");
    const all = isFlag(c.req.valid("query").all);
    if (all && !user.is_admin) return forbidden();
    c.header("Cache-Control", "private, max-age=60");
    return ok({
      shelves: await listShelves(user.is_admin, all, originOf(c.req.url)),
    });
  })
  // GET /api/shelves/seeds — the shipped recipes for the "New shelf" dialog
  .get("/seeds", requireAdmin, queryV(seedsQuery), (c) => {
    const language = seedLanguage(c.req.valid("query").lang);
    return ok({ seeds: seedSummaries(language) });
  })
  // GET /api/shelves/for-title — which shelves hold a title, for the Add to shelf menus
  .get("/for-title", requireAdmin, queryV(forTitleQuery), async (c) => {
    const { tmdb_id, type } = c.req.valid("query");
    return ok({ shelves: await shelvesForTitle(tmdb_id, type) });
  })
  // PUT /api/shelves/order — the order of shelves on the TV and in the editor
  .put("/order", requireAdmin, jsonV(orderBody), async (c) => {
    const moved = await reorderShelves(c.req.valid("json").ids);
    return moved ? ok({ ok: true }) : badRequest("Unknown shelf id");
  })
  // GET /api/shelves/cover-candidates — TMDB backdrops of one title, for the cover picker
  .get(
    "/cover-candidates",
    requireAdmin,
    queryV(
      z.object({
        tmdb_id: z.coerce.number().int().positive(),
        type: mediaTypeV,
      }),
    ),
    async (c) => {
      const { tmdb_id, type } = c.req.valid("query");
      const apiKey = await fetchShelfTmdbKey();
      if (!apiKey) return badRequest("TMDB is not configured");
      return ok({
        backdrops: await fetchShelfBackdropCandidates(apiKey, tmdb_id, type),
      });
    },
  )
  .get("/:id", async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    const shelf = await getShelfDetail(
      id,
      c.get("user").is_admin,
      originOf(c.req.url),
    );
    if (!shelf) return notFound("Shelf not found");
    c.header("Cache-Control", "private, max-age=60");
    return ok({ shelf });
  })
  // POST /api/shelves — create empty, or fill once from a seed
  .post("/", requireAdmin, jsonV(createBody), async (c) => {
    const body = c.req.valid("json");
    const created = await createShelf(
      {
        name: body.name,
        description: body.description,
        seed: body.seed,
        orderMode: body.order_mode,
        coverStyle: body.cover_style,
        coverTmdbId: body.cover_tmdb_id,
        coverType: body.cover_type,
        homeRow: body.home_row,
        visibleFrom: body.visible_from,
        visibleTo: body.visible_to,
      },
      seedLanguage(c.req.query("lang")),
    );
    if (!created.ok) {
      if (created.reason === "seed_not_found")
        return badRequest("Unknown seed");
      if (created.reason === "tmdb_not_configured") {
        return badRequest("TMDB is not configured");
      }
      return badRequest("The seed returned no titles");
    }
    const shelf = await getShelfDetail(created.id, true, originOf(c.req.url));
    if (!shelf) return serverError("Shelf was not created");
    return ok({ shelf }, 201);
  })
  .patch("/:id", requireAdmin, jsonV(updateBody), async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    const body = c.req.valid("json");
    const updated = await updateShelf(id, {
      name: body.name,
      description: body.description,
      orderMode: body.order_mode,
      coverStyle: body.cover_style,
      coverTmdbId: body.cover_tmdb_id,
      coverType: body.cover_type,
      homeRow: body.home_row,
      visibleFrom: body.visible_from,
      visibleTo: body.visible_to,
    });
    if (!updated) return notFound("Shelf not found");
    const shelf = await getShelfDetail(id, true, originOf(c.req.url));
    if (!shelf) return notFound("Shelf not found");
    return ok({ shelf });
  })
  .delete("/:id", requireAdmin, async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    return (await deleteShelf(id))
      ? ok({ ok: true })
      : notFound("Shelf not found");
  })
  // POST /api/shelves/:id/cover — an uploaded cover image (multipart, field "cover")
  .post("/:id/cover", requireAdmin, async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    const form = await c.req.parseBody();
    const file = form.cover;
    if (!(file instanceof File)) return badRequest("A cover image is required");
    const saved = await saveShelfCover(file);
    if (!saved.ok) return badRequest(coverError(saved.reason));
    if (!(await setShelfCoverFile(id, saved.file))) {
      return notFound("Shelf not found");
    }
    const shelf = await getShelfDetail(id, true, originOf(c.req.url));
    return shelf ? ok({ shelf }) : serverError("Shelf was not saved");
  })
  .post("/:id/entries", requireAdmin, jsonV(addEntryBody), async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    const body = c.req.valid("json");
    const added = await addShelfEntry(id, {
      tmdbId: body.tmdb_id,
      type: body.type as ShelfMediaType,
      season: body.season,
      position: body.position,
      groupLabel: body.group_label,
    });
    if (!added.ok) {
      switch (added.reason) {
        case "shelf_not_found":
          return notFound("Shelf not found");
        case "invalid_season":
          return badRequest("A season needs a show");
        case "tmdb_not_configured":
          return badRequest("TMDB is not configured");
        case "title_not_found":
          return badRequest("Title not found on TMDB");
        default:
          return badRequest("Could not add the title");
      }
    }
    return ok({ entry: added.entry });
  })
  .patch("/:id/entries", requireAdmin, jsonV(moveEntriesBody), async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    const moved = await reorderShelfEntries(
      id,
      c.req.valid("json").entries.map((entry) => ({
        id: entry.id,
        position: entry.position,
        groupLabel: entry.group_label ?? null,
      })),
    );
    return moved ? ok({ ok: true }) : badRequest("Unknown entry");
  })
  .delete("/:id/entries/:entryId", requireAdmin, async (c) => {
    const id = pathId(c.req.param("id"));
    const entryId = pathId(c.req.param("entryId"));
    if (id == null || entryId == null) return notFound("Entry not found");
    const result = await removeShelfEntry(id, entryId);
    if (result === "not_found") return notFound("Entry not found");
    return ok({ ok: true, excluded: result === "excluded" });
  })
  .notFound(() => notFound("Not found"));
