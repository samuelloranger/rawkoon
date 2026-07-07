import { DOWNLOADS_ENDPOINTS } from "./downloads";

export const DASHBOARD_ENDPOINTS = {
  ACTIVITIES: "/api/dashboard/activities",
  ACTIVITIES_FEED: "/api/dashboard/activities/feed",
  JELLYFIN: {
    IMAGE: "/api/dashboard/jellyfin/image",
    NOW_PLAYING: "/api/dashboard/jellyfin/now-playing",
  },
  UPCOMING: {
    LIST: "/api/dashboard/upcoming",
    REFRESH: "/api/dashboard/upcoming/refresh",
    ADD: "/api/dashboard/upcoming/add",
    STATUS: "/api/dashboard/upcoming/status",
  },
  DOWNLOADS: DOWNLOADS_ENDPOINTS,
} as const;
