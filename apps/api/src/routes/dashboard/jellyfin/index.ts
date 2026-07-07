import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import {
  mapJellyfinSessions,
  appendJellyfinImageSizing,
} from "@rawkoon/api/utils/dashboard/jellyfin";
import { normalizeJellyfinConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { badGateway, notFound, serverError } from "@rawkoon/api/errors";

export const dashboardJellyfinRoutes = new Elysia()
  .use(auth)
  .use(requireUser)
  .get(
    "/jellyfin/image",
    async ({ user: _user, query, set }) => {
      try {
        const jellyfinIntegration =
          await getIntegrationConfigRecord("jellyfin");

        if (!jellyfinIntegration?.enabled) {
          return notFound(set, "Jellyfin integration not enabled");
        }

        const config = normalizeJellyfinConfig(jellyfinIntegration.config);
        if (!config) {
          return notFound(set, "Jellyfin integration not configured");
        }

        const candidates =
          query.preferred === "primary"
            ? ([
                {
                  itemId: query.itemId,
                  imageType: "Primary",
                  tag: query.primaryTag,
                },
                {
                  itemId: query.itemId,
                  imageType: "Backdrop",
                  tag: query.backdropTag,
                },
                {
                  itemId: query.parentBackdropItemId,
                  imageType: "Backdrop",
                  tag: query.parentBackdropTag,
                },
              ] as const)
            : ([
                {
                  itemId: query.itemId,
                  imageType: "Backdrop",
                  tag: query.backdropTag,
                },
                {
                  itemId: query.parentBackdropItemId,
                  imageType: "Backdrop",
                  tag: query.parentBackdropTag,
                },
                {
                  itemId: query.itemId,
                  imageType: "Primary",
                  tag: query.primaryTag,
                },
              ] as const);

        for (const candidate of candidates) {
          if (!candidate.itemId) continue;

          const imageUrl = new URL(
            `/Items/${encodeURIComponent(candidate.itemId)}/Images/${candidate.imageType}`,
            config.website_url,
          );
          if (candidate.tag) {
            imageUrl.searchParams.set("tag", candidate.tag);
          }
          appendJellyfinImageSizing(imageUrl, candidate.imageType);

          const response = await fetch(imageUrl.toString(), {
            headers: {
              "X-Emby-Token": config.api_key,
              Accept: "image/*",
            },
          });

          const contentType = response.headers.get("content-type");
          if (
            !response.ok ||
            !contentType ||
            !contentType.startsWith("image/")
          ) {
            continue;
          }

          const imageBuffer = await response.arrayBuffer();
          return new Response(imageBuffer, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "private, max-age=21600",
            },
          });
        }

        return notFound(set, "Image not found");
      } catch (error) {
        console.error("Error proxying Jellyfin image:", error);
        return serverError(set, "Failed to proxy Jellyfin image");
      }
    },
    {
      query: t.Object({
        itemId: t.String(),
        preferred: t.Optional(t.String()),
        parentBackdropItemId: t.Optional(t.String()),
        backdropTag: t.Optional(t.String()),
        parentBackdropTag: t.Optional(t.String()),
        primaryTag: t.Optional(t.String()),
      }),
    },
  )
  .get("/jellyfin/now-playing", async ({ user: _user, set }) => {
    try {
      const jellyfinIntegration = await getIntegrationConfigRecord("jellyfin");

      if (!jellyfinIntegration?.enabled) {
        return { enabled: false, sessions: [] };
      }

      const config = normalizeJellyfinConfig(jellyfinIntegration.config);
      if (!config) {
        return { enabled: false, sessions: [] };
      }

      const sessionsUrl = new URL("/Sessions", config.website_url);
      const response = await fetch(sessionsUrl.toString(), {
        headers: {
          "X-Emby-Token": config.api_key,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return badGateway(set, "Failed to reach Jellyfin");
      }

      const data = (await response.json()) as unknown;
      const rawSessions = Array.isArray(data) ? data : [];

      return {
        enabled: true,
        sessions: mapJellyfinSessions(rawSessions, config),
      };
    } catch (error) {
      console.error("Error getting Jellyfin now-playing sessions:", error);
      return serverError(set, "Failed to get Jellyfin now-playing sessions");
    }
  });
