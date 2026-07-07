export const QUALITY_PROFILES_ENDPOINTS = {
  LIST: "/api/quality-profiles",
  CREATE: "/api/quality-profiles",
  UPDATE: (id: number) => `/api/quality-profiles/${id}`,
  DELETE: (id: number) => `/api/quality-profiles/${id}`,
} as const;
