export const DOWNLOADS_ENDPOINTS = {
  SPEED: "/api/dashboard/downloads/speed",
  SEEDING: "/api/downloads/seeding",
  RELEASE: (hash: string) => `/api/downloads/seeding/${hash}/release`,
  ORPHANS: "/api/downloads/orphans",
  REMOVE_ORPHANS: "/api/downloads/orphans/remove",
  SEED_RULES: "/api/downloads/seed-rules",
  SEED_RULE: (indexer: string) =>
    `/api/downloads/seed-rules/${encodeURIComponent(indexer)}`,
  JANITOR_STATS: "/api/downloads/janitor-stats",
} as const;
