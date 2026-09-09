import { Elysia } from "elysia";
import { z } from "zod";
import type { CustomFormat, Prisma } from "@prisma/client";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serverError,
} from "@rawkoon/api/errors";
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

export const customFormatsRoutes = new Elysia({
  prefix: "/api/custom-formats",
})
  .use(auth)
  .use(requireUser)
  .get("/", async ({ set }) => {
    try {
      const rows = await prisma.customFormat.findMany({
        orderBy: { name: "asc" },
      });
      return { custom_formats: rows.map(mapCustomFormat) };
    } catch {
      return serverError("Failed to list custom formats");
    }
  })
  .post(
    "/",
    async ({ user, body, set }) => {
      if (!user?.is_admin) return forbidden("Admin access required");
      const v = validateFormatConditions(body.conditions);
      if (!v.ok) return badRequest(v.code);
      try {
        const row = await prisma.customFormat.create({
          data: {
            name: body.name.trim(),
            conditions: v.conditions as unknown as Prisma.InputJsonValue,
          },
        });
        return Response.json(
          { custom_format: mapCustomFormat(row) },
          { status: 201 },
        );
      } catch (e: unknown) {
        const isUnique =
          e &&
          typeof e === "object" &&
          "code" in e &&
          (e as { code: string }).code === "P2002";
        if (isUnique)
          return conflict("A custom format with this name already exists");
        return serverError("Failed to create custom format");
      }
    },
    {
      body: z.object({
        name: z.string().min(1),
        conditions: z.array(z.record(z.string(), z.any())),
      }),
    },
  )
  .put(
    "/:id",
    async ({ user, params, body, set }) => {
      if (!user?.is_admin) return forbidden("Admin access required");
      const id = parseInt(params.id, 10);
      if (!Number.isFinite(id)) return badRequest("Invalid id");
      const v = validateFormatConditions(body.conditions);
      if (!v.ok) return badRequest(v.code);
      try {
        const existing = await prisma.customFormat.findUnique({
          where: { id },
        });
        if (!existing) return notFound("Custom format not found");
        const row = await prisma.customFormat.update({
          where: { id },
          data: {
            name: body.name.trim(),
            conditions: v.conditions as unknown as Prisma.InputJsonValue,
          },
        });
        return { custom_format: mapCustomFormat(row) };
      } catch (e: unknown) {
        const isUnique =
          e &&
          typeof e === "object" &&
          "code" in e &&
          (e as { code: string }).code === "P2002";
        if (isUnique)
          return conflict("A custom format with this name already exists");
        return serverError("Failed to update custom format");
      }
    },
    {
      body: z.object({
        name: z.string().min(1),
        conditions: z.array(z.record(z.string(), z.any())),
      }),
    },
  )
  .delete("/:id", async ({ user, params, set }) => {
    if (!user?.is_admin) return forbidden("Admin access required");
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return badRequest("Invalid id");
    try {
      const existing = await prisma.customFormat.findUnique({ where: { id } });
      if (!existing) return notFound("Custom format not found");

      const inUse = await prisma.qualityProfileCustomFormat.count({
        where: { customFormatId: id },
      });
      if (inUse > 0) {
        return conflict(
          "Cannot delete custom format while quality profiles are using it",
        );
      }

      await prisma.customFormat.delete({ where: { id } });
      return { deleted: true };
    } catch {
      return serverError("Failed to delete custom format");
    }
  });
