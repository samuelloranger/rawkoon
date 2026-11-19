import type { DoctorCheck } from "@rawkoon/shared/types";
import { describeError } from "@rawkoon/api/utils/describeError";
import type { CheckOutcome } from "./status";

export const DOCTOR_TIMEOUT_MS = 5000;

export type Draft = { id: string; title: string } & CheckOutcome;

export interface CheckDef {
  /** Fallback check id/title when the probe throws before producing drafts. */
  id: string;
  title: string;
  /** Fallback fix when the probe crashes; returned drafts carry their own. */
  fixOnCrash: string | null;
  /** Per-def bound; defaults to DOCTOR_TIMEOUT_MS. */
  timeoutMs?: number;
  run: () => Promise<Draft[]>;
}

// Name matches the DOMException AbortSignal.timeout produces, so
// describeError classifies a lost race as "timed out".
class ProbeTimeout extends Error {
  constructor(label: string) {
    super(`${label} timed out`);
    this.name = "TimeoutError";
  }
}

/** Bounds one probe so a hung dependency can never stall the report. */
function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number = DOCTOR_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeTimeout(label)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function draft(id: string, title: string, outcome: CheckOutcome): Draft {
  return { id, title, ...outcome };
}

export async function runCheck(def: CheckDef): Promise<DoctorCheck[]> {
  const startedAt = Date.now();
  let drafts: Draft[];
  try {
    drafts = await withTimeout(def.run(), def.title, def.timeoutMs);
  } catch (error) {
    // A throwing check is a failed check — the report itself never crashes.
    drafts = [
      draft(def.id, def.title, {
        status: "fail",
        summary: `Could not be checked: ${describeError(error)}.`,
        fix: def.fixOnCrash,
      }),
    ];
  }
  const duration_ms = Date.now() - startedAt;
  return drafts.map((d) => ({ ...d, duration_ms }));
}
