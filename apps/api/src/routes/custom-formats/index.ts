import { Hono } from "hono";
import { z } from "zod";
import type { CustomFormat, Prisma } from "@prisma/client";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  serverError,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  createCustomFormat,
  deleteCustomFormat,
  listCustomFormats,
  updateCustomFormat,
} from "@rawkoon/api/services/customFormats/customFormatStore";
import { validateFormatConditions } from "@rawkoon/api/utils/medias/customFormatValidation";

function mapCustomFormat(f: CustomFormat) {
  return {
    id: f.id,
    name: f.name,
    conditions: f.conditions,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

const upsertBody = z.object({
  name: z.string().min(1),
  conditions: z.array(z.record(z.string(), z.any())),
});

const isUniqueViolation = (e: unknown): boolean =>
  !!e &&
  typeof e === "object" &&
  "code" in e &&
  (e as { code: string }).code === "P2002";

// Mounted at /api/custom-formats by the edge.
export const customFormatsRoutes = new Hono<Env>()
  .use("*", requireUser)
  .get("/", async () => {
    try {
      const rows = await listCustomFormats();
      return ok({ custom_formats: rows.map(mapCustomFormat) });
    } catch {
      return serverError("Failed to list custom formats");
    }
  })
  .post("/", jsonV(upsertBody), async (c) => {
    if (!c.get("user").is_admin) return forbidden("Admin access required");
    const body = c.req.valid("json");
    const v = validateFormatConditions(body.conditions);
    if (!v.ok) return badRequest(v.code);
    try {
      const row = await createCustomFormat(
        body.name.trim(),
        v.conditions as unknown as Prisma.InputJsonValue,
      );
      return ok({ custom_format: mapCustomFormat(row) }, 201);
    } catch (e: unknown) {
      if (isUniqueViolation(e))
        return conflict("A custom format with this name already exists");
      return serverError("Failed to create custom format");
    }
  })
  .put("/:id", jsonV(upsertBody), async (c) => {
    if (!c.get("user").is_admin) return forbidden("Admin access required");
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return badRequest("Invalid id");
    const body = c.req.valid("json");
    const v = validateFormatConditions(body.conditions);
    if (!v.ok) return badRequest(v.code);
    try {
      const result = await updateCustomFormat(
        id,
        body.name.trim(),
        v.conditions as unknown as Prisma.InputJsonValue,
      );
      if (result.status === "not_found") {
        return notFound("Custom format not found");
      }
      return ok({ custom_format: mapCustomFormat(result.row) });
    } catch (e: unknown) {
      if (isUniqueViolation(e))
        return conflict("A custom format with this name already exists");
      return serverError("Failed to update custom format");
    }
  })
  .delete("/:id", async (c) => {
    if (!c.get("user").is_admin) return forbidden("Admin access required");
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return badRequest("Invalid id");
    try {
      const result = await deleteCustomFormat(id);
      if (result.status === "not_found") {
        return notFound("Custom format not found");
      }
      if (result.status === "in_use") {
        return conflict(
          "Cannot delete custom format while quality profiles are using it",
        );
      }
      return ok({ deleted: true });
    } catch {
      return serverError("Failed to delete custom format");
    }
  })
  .notFound(() => notFound("Not found"));
