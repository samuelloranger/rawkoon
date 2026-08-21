export const BOOKS_ENDPOINTS = {
  LIST: "/api/books",
  SEARCH: "/api/books/search",
  ADD: "/api/books",
  DETAIL: (id: number) => `/api/books/${id}`,
  DELETE: (id: number) => `/api/books/${id}`,
  EDITION: (id: number, kind: string) => `/api/books/${id}/editions/${kind}`,
  ADD_EDITION: (id: number) => `/api/books/${id}/editions`,
  EDITION_FILES: (id: number, kind: string) =>
    `/api/books/${id}/editions/${kind}/files`,
  RESCAN: (id: number, kind: string) =>
    `/api/books/${id}/editions/${kind}/rescan`,
  RELEASE_SEARCH: (id: number, kind: string) =>
    `/api/books/${id}/editions/${kind}/search`,
  GRAB: (id: number, kind: string) => `/api/books/${id}/editions/${kind}/grab`,
  AUTO_GRAB: (id: number, kind: string) =>
    `/api/books/${id}/editions/${kind}/auto`,
  FILE_CONTENT: (fileId: number) => `/api/books/files/${fileId}/content`,
  MANIFEST: (editionId: number) => `/api/books/editions/${editionId}/manifest`,
  PROGRESS: (editionIds: number[]) =>
    `/api/books/progress?editionIds=${editionIds.join(",")}`,
  READING: (limit: number) => `/api/books/reading?limit=${limit}`,
  EDITION_PROGRESS: (editionId: number) =>
    `/api/books/editions/${editionId}/progress`,
  EDITION_PROGRESS_FINISH: (editionId: number) =>
    `/api/books/editions/${editionId}/progress/finish`,
  EDITION_PROGRESS_RESET: (editionId: number) =>
    `/api/books/editions/${editionId}/progress/reset`,
  QUALITY_PROFILES: "/api/book-quality-profiles",
  AUTHORS: "/api/authors",
  AUTHOR: (id: number) => `/api/authors/${id}`,
} as const;
