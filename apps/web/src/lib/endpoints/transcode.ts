export const TRANSCODE_ENDPOINTS = {
  CAPABILITIES: "/api/transcode/capabilities",
  ESTIMATE: "/api/transcode/estimate",
  JOBS: "/api/transcode/jobs",
  JOB: (id: number) => `/api/transcode/jobs/${id}`,
  JOB_MOVE: (id: number) => `/api/transcode/jobs/${id}/move`,
  JOB_RETRY: (id: number) => `/api/transcode/jobs/${id}/retry`,
  BATCH: (id: string) => `/api/transcode/batches/${id}`,
  BATCH_MOVE: (id: string) => `/api/transcode/batches/${id}/move`,
  HISTORY: "/api/transcode/history",
  SETTINGS: "/api/transcode/settings",
  SUMMARY: "/api/transcode/summary",
};
