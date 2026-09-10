import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  DEFAULT_TMDB_REGION,
  normalizeTmdbRegion,
} from "@rawkoon/api/utils/medias/tmdbRegion";

import type { AppSettings } from "@prisma/client";

function mapSettings(row: AppSettings) {
  return {
    country_code: normalizeTmdbRegion(row.countryCode),
    upcoming_window_months: row.upcomingWindowMonths,
    upcoming_languages: row.upcomingLanguages,
    books_enabled: row.booksEnabled,
    updated_at: row.updatedAt.toISOString(),
  };
}

const patchBody = z.object({
  country_code: z.string().min(2).max(2).optional(),
  upcoming_window_months: z.number().int().optional(),
  upcoming_languages: z.string().optional(),
  books_enabled: z.boolean().optional(),
});

// Mounted at /api/settings by the edge.
export const settingsRoutes = new Hono<Env>()
  .use("*", requireAdmin)
  .get("/", async () => {
    try {
      const row = await prisma.appSettings.upsert({
        where: { id: 1 },
        create: { id: 1, countryCode: DEFAULT_TMDB_REGION },
        update: {},
      });
      return ok({ settings: mapSettings(row) });
    } catch {
      return serverError("Failed to load settings");
    }
  })
  .patch("/", jsonV(patchBody), async (c) => {
    const body = c.req.valid("json");
    try {
      const trimmedCountry = body.country_code?.trim().toUpperCase();
      if (body.country_code && !/^[A-Z]{2}$/.test(trimmedCountry ?? "")) {
        return badRequest("country_code must be a 2-letter ISO code");
      }
      const countryCode = trimmedCountry || null;

      const updateData: {
        countryCode?: string;
        upcomingWindowMonths?: number;
        upcomingLanguages?: string;
        booksEnabled?: boolean;
      } = {};

      if (body.country_code && countryCode)
        updateData.countryCode = countryCode;
      if (body.upcoming_window_months !== undefined) {
        const months = body.upcoming_window_months;
        if (![3, 6, 12, 24].includes(months)) {
          return badRequest(
            "upcoming_window_months must be one of: 3, 6, 12, 24",
          );
        }
        updateData.upcomingWindowMonths = months;
      }
      if (body.upcoming_languages !== undefined) {
        updateData.upcomingLanguages = body.upcoming_languages;
      }
      if (body.books_enabled !== undefined) {
        updateData.booksEnabled = body.books_enabled;
      }

      const row = await prisma.appSettings.upsert({
        where: { id: 1 },
        create: { id: 1, countryCode: countryCode ?? DEFAULT_TMDB_REGION },
        update: updateData,
      });
      return ok({ settings: mapSettings(row) });
    } catch {
      return serverError("Failed to update settings");
    }
  })
  .notFound(() => notFound("Not found"));
