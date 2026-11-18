export type DoctorStatus = "ok" | "warn" | "fail";

/**
 * One doctor finding. The JSON is a stable contract — an MCP server and the
 * CLI both render this shape — so ids stay snake_case and fields additive.
 */
export interface DoctorCheck {
  /** Stable snake_case id, e.g. "database", "library_path_movies". */
  id: string;
  /** Short human label shown next to the status. */
  title: string;
  status: DoctorStatus;
  /** One sentence of what was found. */
  summary: string;
  /** One sentence on how to fix it; null when ok. */
  fix: string | null;
  /** How long the probe took. */
  duration_ms: number;
}

export interface DoctorReport {
  /** Worst of the checks' statuses. */
  status: DoctorStatus;
  /** getAppVersion() at run time. */
  version: string;
  /** ISO timestamp of the run. */
  checked_at: string;
  checks: DoctorCheck[];
}
