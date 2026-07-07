export const CUSTOM_FORMATS_ENDPOINTS = {
  LIST: "/api/custom-formats",
  CREATE: "/api/custom-formats",
  UPDATE: (id: number) => `/api/custom-formats/${id}`,
  DELETE: (id: number) => `/api/custom-formats/${id}`,
} as const;
