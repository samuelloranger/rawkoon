import { Elysia, t } from "elysia";

import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, serverError } from "@rawkoon/api/errors";
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
    updated_at: row.updatedAt.toISOString(),
  };
}

export const settingsRoutes = new Elysia({ prefix: "/api/settings" })
  .use(requireAdmin)
  .get("/", async ({ set }) => {
    try {
      const row = await prisma.appSettings.upsert({
        where: { id: 1 },
        create: { id: 1, countryCode: DEFAULT_TMDB_REGION },
        update: {},
      });
      return { settings: mapSettings(row) };
    } catch {
      return serverError(set, "Failed to load settings");
    }
  })
  .patch(
    "/",
    async ({ body, set }) => {
      try {
        const trimmedCountry = body.country_code?.trim().toUpperCase();
        if (body.country_code && !/^[A-Z]{2}$/.test(trimmedCountry ?? "")) {
          return badRequest(set, "country_code must be a 2-letter ISO code");
        }
        const countryCode = trimmedCountry || null;

        const updateData: {
          countryCode?: string;
          upcomingWindowMonths?: number;
          upcomingLanguages?: string;
        } = {};

        if (body.country_code && countryCode)
          updateData.countryCode = countryCode;
        if (body.upcoming_window_months !== undefined) {
          const months = body.upcoming_window_months;
          if (![3, 6, 12, 24].includes(months)) {
            return badRequest(
              set,
              "upcoming_window_months must be one of: 3, 6, 12, 24",
            );
          }
          updateData.upcomingWindowMonths = months;
        }
        if (body.upcoming_languages !== undefined) {
          updateData.upcomingLanguages = body.upcoming_languages;
        }

        const row = await prisma.appSettings.upsert({
          where: { id: 1 },
          create: {
            id: 1,
            countryCode: countryCode ?? DEFAULT_TMDB_REGION,
          },
          update: updateData,
        });
        return { settings: mapSettings(row) };
      } catch {
        return serverError(set, "Failed to update settings");
      }
    },
    {
      body: t.Object({
        country_code: t.Optional(t.String({ minLength: 2, maxLength: 2 })),
        upcoming_window_months: t.Optional(t.Integer()),
        upcoming_languages: t.Optional(t.String()),
      }),
    },
  );
