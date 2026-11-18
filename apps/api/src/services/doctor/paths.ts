import type { CheckOutcome } from "./status";

/** Filesystem facts about one configured path, gathered by the caller (fs at the edges). */
export interface PathProbe {
  exists: boolean;
  isDirectory: boolean;
  readableAndWritable: boolean;
  /** describeError() text when stat itself failed for a reason other than absence. */
  error: string | null;
}

/** A missing probe means the path was never configured — the warn is the fix's pointer. */
export function evaluatePathAccess(
  path: string | null,
  probe: PathProbe,
): CheckOutcome {
  if (!path) {
    return {
      status: "warn",
      summary: "Not configured.",
      fix: "Set the path under Settings → Library.",
    };
  }
  if (probe.error) {
    return {
      status: "fail",
      summary: `Could not inspect ${path} (${probe.error}).`,
      fix: "Check that the mount exists and the parent directory is traversable.",
    };
  }
  if (!probe.exists) {
    return {
      status: "warn",
      summary: `${path} does not exist.`,
      fix: "Create the directory or correct the path under Settings → Library.",
    };
  }
  if (!probe.isDirectory) {
    return {
      status: "warn",
      summary: `${path} exists but is not a directory.`,
      fix: "Point Settings → Library at a directory.",
    };
  }
  if (!probe.readableAndWritable) {
    return {
      status: "fail",
      summary: `${path} exists but this process cannot read and write it.`,
      fix: "Give the user the Rawkoon container runs as (PUID/PGID) ownership of the directory, then restart.",
    };
  }
  return {
    status: "ok",
    summary: `${path} is readable and writable.`,
    fix: null,
  };
}

/** One statfs() reading; freeBytes is null when the volume could not be measured. */
export interface FreeSpaceReading {
  id: string;
  freeBytes: number | null;
  /** describeError() text when statfs failed for a reason other than absence. */
  error: string | null;
}

// GiB, though the setting and UI call it GB.
const GB = 1024 ** 3;

const describeReading = (reading: FreeSpaceReading) =>
  `${reading.id}: ${
    reading.freeBytes === null
      ? `unknown${reading.error ? ` (${reading.error})` : ""}`
      : `${(reading.freeBytes / GB).toFixed(1)} GB free`
  }`;

/** Pure: free-space readings against the configured minimum (0 disables the guard). */
export function evaluateFreeSpace(
  minFreeGb: number,
  readings: readonly FreeSpaceReading[],
): CheckOutcome {
  if (readings.length === 0) {
    return {
      status: "ok",
      summary: "No configured path to measure.",
      fix: null,
    };
  }

  const measured = readings.filter(
    (reading): reading is FreeSpaceReading & { freeBytes: number } =>
      reading.freeBytes !== null,
  );

  if (measured.length === 0) {
    return {
      status: "warn",
      summary: `Free space could not be measured (${readings
        .map(describeReading)
        .join(", ")}).`,
      fix: "Check that the volumes are mounted and readable by the container user.",
    };
  }

  if (minFreeGb > 0) {
    const low = measured.filter(
      (reading) => reading.freeBytes / GB < minFreeGb,
    );
    if (low.length > 0) {
      return {
        status: "warn",
        summary: `Below the ${minFreeGb} GB minimum — ${low
          .map(describeReading)
          .join(", ")}.`,
        fix: "Free up space on that volume or lower the minimum free space under Settings → Library.",
      };
    }
    return {
      status: "ok",
      summary: `${readings
        .map(describeReading)
        .join(", ")} (minimum ${minFreeGb} GB).`,
      fix: null,
    };
  }

  return {
    status: "ok",
    summary: `${readings.map(describeReading).join(", ")} (no minimum set).`,
    fix: null,
  };
}
