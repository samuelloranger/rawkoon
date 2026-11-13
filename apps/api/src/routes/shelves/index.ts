import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  badGateway,
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
  shelfHasCoverFile,
  updateShelf,
} from "@rawkoon/api/services/shelves/shelfService";
import {
  previewRules,
  seedFromRules,
} from "@rawkoon/api/services/shelves/shelfRulesService";
import { searchLookup } from "@rawkoon/api/services/shelves/shelfLookups";
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

const tmdbIdsV = z.array(z.number().int().positive()).max(50);

/** Strict, so a misspelt field is an error instead of a rule that silently selects nothing. */
const rulesV = z
  .object({
    types: z.array(mediaTypeV).max(2).optional(),
    genres_any: tmdbIdsV.optional(),
    genres_none: tmdbIdsV.optional(),
    keywords_any: tmdbIdsV.optional(),
    keywords_none: tmdbIdsV.optional(),
    companies_any: tmdbIdsV.optional(),
    networks_any: tmdbIdsV.optional(),
    tmdb_collection: z.number().int().positive().optional(),
    year_min: z.number().int().min(1800).max(2200).optional(),
    year_max: z.number().int().min(1800).max(2200).optional(),
    votes_min: z.number().int().min(0).optional(),
    rating_min: z.number().min(0).max(10).optional(),
    certifications: z
      .array(z.string().trim().min(1).max(12))
      .max(20)
      .optional(),
  })
  .strict();

const previewBody = z.object({ rules: rulesV });
const lookupQuery = z.object({ q: z.string().trim().max(80).default("") });

const coverFields = {
  cover_style: coverStyleV.optional(),
  cover_tmdb_id: z.number().int().positive().nullish(),
  cover_type: mediaTypeV.nullish(),
  /** A picked backdrop image (TMDB) instead of the cover title's first. */
  cover_url: z.url().startsWith("https://image.tmdb.org/t/p/").nullish(),
};

const shelfBody = {
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  order_mode: orderModeV.optional(),
  ...coverFields,
  home_row: z.boolean().optional(),
  visible_from: mmddV.nullish(),
  visible_to: mmddV.nullish(),
  rules: rulesV.nullable().optional(),
  auto_join: z.boolean().optional(),
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
  .refine(coverTitleRefine.test, { message: coverTitleRefine.message })
  // An upload cover only exists once a file is uploaded to a shelf
  .refine((body) => body.cover_style !== "upload", {
    message: "Upload a cover image to use the upload style",
  });

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

/** The scheme and host the caller reached, behind a TLS proxy too: an uploaded cover is served back from there. */
const originOf = (c: Context) => {
  const url = new URL(c.req.url);
  const first = (name: string) =>
    c.req.header(name)?.split(",")[0]?.trim() || null;
  const proto = first("x-forwarded-proto");
  const scheme =
    proto === "http" || proto === "https" ? proto : url.protocol.slice(0, -1);
  return `${scheme}://${first("x-forwarded-host") ?? url.host}`;
};

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
    // Editors read this right after a write; a browser cache would show them the old cover
    c.header("Cache-Control", "private, no-store");
    return ok({
      shelves: await listShelves(user.is_admin, all, originOf(c)),
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
  // GET /api/shelves/lookup/keywords|companies?q= — cached TMDB search for the rules editor
  .get("/lookup/:kind", requireAdmin, queryV(lookupQuery), async (c) => {
    const kind =
      c.req.param("kind") === "keywords"
        ? "keyword"
        : c.req.param("kind") === "companies"
          ? "company"
          : null;
    if (!kind) return notFound("Not found");
    try {
      const items = await searchLookup(kind, c.req.valid("query").q);
      return items ? ok({ items }) : badRequest("TMDB is not configured");
    } catch {
      return badGateway("TMDB search failed");
    }
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
    const shelf = await getShelfDetail(id, c.get("user").is_admin, originOf(c));
    if (!shelf) return notFound("Shelf not found");
    c.header("Cache-Control", "private, no-store");
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
        coverUrl: body.cover_url,
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
      if (created.reason === "seed_failed") {
        return badGateway("TMDB did not answer; try the seed again");
      }
      return badRequest("The seed returned no titles");
    }
    const shelf = await getShelfDetail(created.id, true, originOf(c));
    if (!shelf) return serverError("Shelf was not created");
    return ok({ shelf }, 201);
  })
  .patch("/:id", requireAdmin, jsonV(updateBody), async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    const body = c.req.valid("json");
    if (body.cover_style === "upload" && !(await shelfHasCoverFile(id))) {
      return badRequest("Upload a cover image to use the upload style");
    }
    const result = await updateShelf(id, {
      name: body.name,
      description: body.description,
      orderMode: body.order_mode,
      coverStyle: body.cover_style,
      coverTmdbId: body.cover_tmdb_id,
      coverType: body.cover_type,
      coverUrl: body.cover_url,
      homeRow: body.home_row,
      visibleFrom: body.visible_from,
      visibleTo: body.visible_to,
      rules: body.rules,
      autoJoin: body.auto_join,
    });
    if (result === "auto_join_needs_rules") {
      return badRequest("Auto-join needs rules");
    }
    if (result === "not_found") return notFound("Shelf not found");
    const shelf = await getShelfDetail(id, true, originOf(c));
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
  .post(
    "/:id/cover",
    requireAdmin,
    // Headroom over the 5 MB image for the multipart framing; stops a huge body before it is buffered
    bodyLimit({
      maxSize: 6 * 1024 * 1024,
      onError: () => badRequest(coverError("too_large")),
    }),
    async (c) => {
      const id = pathId(c.req.param("id"));
      if (id == null) return notFound("Shelf not found");
      const form = await c.req.parseBody();
      const file = form.cover;
      if (!(file instanceof File))
        return badRequest("A cover image is required");
      const saved = await saveShelfCover(file);
      if (!saved.ok) return badRequest(coverError(saved.reason));
      if (!(await setShelfCoverFile(id, saved.file))) {
        return notFound("Shelf not found");
      }
      const shelf = await getShelfDetail(id, true, originOf(c));
      return shelf ? ok({ shelf }) : serverError("Shelf was not saved");
    },
  )
  // POST /api/shelves/:id/preview — what rules would select, without saving them
  .post("/:id/preview", requireAdmin, jsonV(previewBody), async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    const preview = await previewRules(id, c.req.valid("json").rules);
    return preview ? ok(preview) : notFound("Shelf not found");
  })
  // POST /api/shelves/:id/seed-from-rules — add the current matches once
  .post("/:id/seed-from-rules", requireAdmin, async (c) => {
    const id = pathId(c.req.param("id"));
    if (id == null) return notFound("Shelf not found");
    const seeded = await seedFromRules(id);
    if (!seeded.ok) {
      return seeded.reason === "not_found"
        ? notFound("Shelf not found")
        : badRequest("The shelf has no rules");
    }
    const shelf = await getShelfDetail(id, true, originOf(c));
    return shelf ? ok({ shelf }) : notFound("Shelf not found");
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
