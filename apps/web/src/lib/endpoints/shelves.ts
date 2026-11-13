export const SHELVES_ENDPOINTS = {
  LIST: "/api/shelves",
  /** Admins only: shelves outside their window too, as the editor needs them. */
  ALL: "/api/shelves?all=1",
  DETAIL: (id: number) => `/api/shelves/${id}`,
  CREATE: "/api/shelves",
  UPDATE: (id: number) => `/api/shelves/${id}`,
  DELETE: (id: number) => `/api/shelves/${id}`,
  ORDER: "/api/shelves/order",
  SEEDS: (language: string) =>
    `/api/shelves/seeds?lang=${encodeURIComponent(language)}`,
  ENTRIES: (id: number) => `/api/shelves/${id}/entries`,
  ENTRY: (id: number, entryId: number) =>
    `/api/shelves/${id}/entries/${entryId}`,
};
