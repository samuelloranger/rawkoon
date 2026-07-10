export const ADMIN_ENDPOINTS = {
  TRIGGER_ACTION: "/api/admin/trigger-action",
  SCHEDULED_JOBS: "/api/admin/scheduled-jobs",
  LIBRARY_HEALTH: "/api/admin/library-health",
  QUEUE_JOBS: (name: string) => `/api/admin/queues/${name}/jobs`,
  USERS: "/api/admin/users",
  DELETE_USER: (userId: string) => `/api/admin/users/${userId}`,
  UPDATE_USER_ROLE: (userId: string) => `/api/admin/users/${userId}/role`,
  RESET_USER_PASSWORD: (userId: string) =>
    `/api/admin/users/${userId}/reset-password`,
  INVITATIONS: "/api/admin/invitations",
  INVITE_USER: "/api/admin/invitations",
  RESEND_INVITATION: (id: number) => `/api/admin/invitations/${id}/resend`,
  REVOKE_INVITATION: (id: number) => `/api/admin/invitations/${id}`,
  SESSIONS: "/api/admin/sessions",
  REVOKE_SESSION: (id: string) => `/api/admin/sessions/${id}`,
  REVOKE_USER_SESSIONS: (userId: string) =>
    `/api/admin/sessions/user/${userId}`,
  WEB_PUSH: "/api/admin/web-push",
  DELETE_WEB_PUSH: (id: number) => `/api/admin/web-push/${id}`,
  API_KEYS: "/api/admin/api-keys",
  DELETE_API_KEY: (id: string) => `/api/admin/api-keys/${id}`,
  RETRY_JOB: (queue: string, jobId: string) =>
    `/api/admin/queues/${queue}/jobs/${jobId}/retry`,
  RETRY_FAILED: (queue: string) => `/api/admin/queues/${queue}/retry-failed`,
  CLEAN_QUEUE: (queue: string, status: string, grace?: number) =>
    `/api/admin/queues/${queue}/clean?status=${status}&grace=${grace ?? 0}`,
  JOB_HISTORY: (limit?: number) =>
    `/api/admin/jobs/history?limit=${limit ?? 50}`,
} as const;
