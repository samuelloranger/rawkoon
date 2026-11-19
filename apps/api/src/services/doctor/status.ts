import type { DoctorStatus } from "@rawkoon/shared/types";

/** What every probe returns before the runner stamps id, title and duration. */
export interface CheckOutcome {
  status: DoctorStatus;
  summary: string;
  fix: string | null;
}

const RANK: Record<DoctorStatus, number> = { ok: 0, warn: 1, fail: 2 };

/** Worst wins: the report's status is its most severe check's status. */
export function worstStatus(statuses: readonly DoctorStatus[]): DoctorStatus {
  return statuses.reduce<DoctorStatus>(
    (worst, status) => (RANK[status] > RANK[worst] ? status : worst),
    "ok",
  );
}

export type Dependency = "db" | "valkey";

/** The outcome for a check whose shared dependency is down; null when it is up or unknown. */
export function skippedOutcome(
  needs: Dependency | undefined,
  health: { db: boolean; valkey: boolean } | null,
): CheckOutcome | null {
  if (!needs || health?.[needs] !== false) return null;
  return {
    status: "fail",
    summary: `Skipped: ${needs === "db" ? "the database" : "Valkey"} is unreachable.`,
    fix: null,
  };
}
