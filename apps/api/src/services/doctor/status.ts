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
