import type { GrabReadinessCheck } from "@rawkoon/shared/types";

const DISMISS_KEY = "rawkoon.grabReadiness.dismissed";

export function failingChecks(
  checks: GrabReadinessCheck[] | undefined,
): GrabReadinessCheck[] {
  return (checks ?? []).filter((c) => c.status !== "ok");
}

/** Warnings are advisory; only real errors earn the nav dot. */
export function hasErrorChecks(
  checks: GrabReadinessCheck[] | undefined,
): boolean {
  return (checks ?? []).some((c) => c.status === "error");
}

/** Identifies the set of problems, so a dismissal only holds while that set is unchanged. */
export function failingSignature(checks: GrabReadinessCheck[]): string {
  return failingChecks(checks)
    .map((c) => `${c.id}:${c.status}`)
    .sort()
    .join("|");
}

export function readDismissedSignature(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeDismissedSignature(signature: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, signature);
  } catch {
    // Storage can be unavailable (private mode); the banner just returns next visit.
  }
}
