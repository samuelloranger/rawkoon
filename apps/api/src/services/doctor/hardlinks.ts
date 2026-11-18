import type { CheckOutcome } from "./status";

export interface HardlinkFacts {
  /** mediaSettings.fileOperation: "hardlink", "move" or "none". */
  fileOperation: string;
  /** stat().dev of the downloads path, or null when it is not configured. */
  downloadsDevice: number | null;
  /** stat().dev of each configured library path. */
  libraryDevices: ReadonlyArray<{ id: string; device: number }>;
}

/** Pure: hardlinks cannot cross filesystems — compare the stat() devices. */
export function evaluateHardlinks(facts: HardlinkFacts): CheckOutcome {
  if (facts.fileOperation !== "hardlink") {
    return {
      status: "ok",
      summary: `Imports use "${facts.fileOperation}", so cross-filesystem paths are fine.`,
      fix: null,
    };
  }
  if (facts.downloadsDevice === null || facts.libraryDevices.length === 0) {
    return {
      status: "ok",
      summary: "Not enough readable paths to compare filesystems.",
      fix: null,
    };
  }
  const foreign = facts.libraryDevices.filter(
    (library) => library.device !== facts.downloadsDevice,
  );
  if (foreign.length === 0) {
    return {
      status: "ok",
      summary: "Downloads and every library path are on the same filesystem.",
      fix: null,
    };
  }
  return {
    status: "warn",
    summary: `Hardlink imports cannot cross filesystems: downloads and ${foreign
      .map((library) => library.id)
      .join(", ")} are on different devices.`,
    fix: "Mount a single parent directory that contains both the downloads and library paths.",
  };
}
