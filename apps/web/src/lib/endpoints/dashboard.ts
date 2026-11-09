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
  },
  HERO: "/api/dashboard/hero",
  PIPELINE: "/api/dashboard/pipeline",
  DOWNLOADS: DOWNLOADS_ENDPOINTS,
} as const;
