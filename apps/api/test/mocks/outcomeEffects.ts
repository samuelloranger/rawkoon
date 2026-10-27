import type { OutcomeEffects } from "@rawkoon/api/services/downloads/outcomeEffects";

export type RecordedEffect = { name: keyof OutcomeEffects; args: unknown[] };

/** An OutcomeEffects that records every call instead of notifying anyone. */
export function recordingEffects(): OutcomeEffects & {
  calls: RecordedEffect[];
  named: (name: keyof OutcomeEffects) => unknown[][];
} {
  const calls: RecordedEffect[] = [];
  const rec =
    (name: keyof OutcomeEffects) =>
    async (...args: unknown[]) => {
      calls.push({ name, args });
    };
  return {
    calls,
    named: (name) => calls.filter((c) => c.name === name).map((c) => c.args),
    libraryChanged: (...args) => {
      calls.push({ name: "libraryChanged", args });
    },
    bookChanged: (...args) => {
      calls.push({ name: "bookChanged", args });
    },
    requestAvailable: rec("requestAvailable"),
    downloadFailed: rec("downloadFailed"),
    importLanded: rec("importLanded"),
    mediaDownloaded: rec("mediaDownloaded"),
    bookDownloaded: rec("bookDownloaded"),
    importFailed: rec("importFailed"),
    seedReleaseCheck: rec("seedReleaseCheck"),
    libraryScan: rec("libraryScan"),
  };
}
