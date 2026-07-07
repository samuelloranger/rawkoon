/** Common `{ enabled: false, connected: false, updated_at }` wrapper for dashboard integrations. */
export function buildDisabledDashboardSummary<
  T extends Record<string, unknown>,
>(
  fields: T,
  error?: string,
): T & {
  enabled: false;
  connected: false;
  updated_at: string;
  error?: string;
} {
  return {
    enabled: false,
    connected: false,
    updated_at: new Date().toISOString(),
    ...fields,
    ...(error ? { error } : {}),
  };
}
