import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { evaluateOrphans, selectOrphans } from "./orphanedDownloads";
import { buildLibraryInodeKeySet } from "@rawkoon/api/services/downloads/downloadsScanner";
import { scanDownloads } from "./probes";
import type { CheckOutcome } from "./status";

export const ORPHANS_TIMEOUT_MS = 60_000;

const cannotCheck = (summary: string, fix: string): CheckOutcome => ({
  status: "warn",
  summary: `Could not check: ${summary}`,
  fix,
});

/** Read-only: lists what the downloads folder holds that nothing references. */
export async function checkOrphanedDownloads(
  downloadsPath: string | null,
): Promise<CheckOutcome> {
  if (!downloadsPath) {
    return {
      status: "ok",
      summary: "No downloads path configured.",
      fix: null,
    };
  }
  const deadlineMs = Date.now() + ORPHANS_TIMEOUT_MS - 2000;
  const active = await resolveActiveAdapter().catch(() => null);
  if (!active) {
    return cannotCheck(
      "no download client is configured.",
      "Configure a download client under Settings, then re-run the doctor.",
    );
  }
  // Without the client's torrent list every entry would look orphaned.
  const torrents = await active.adapter.listTorrents().catch(() => null);
  if (!torrents) {
    return cannotCheck(
      "the download client is unreachable.",
      "Check the download client under Settings, then re-run the doctor.",
    );
  }
  const entries = await scanDownloads(
    downloadsPath,
    await buildLibraryInodeKeySet(),
    deadlineMs,
  );
  if (torrents.length === 0 && entries.length > 0) {
    return cannotCheck(
      "the download client reports no torrents, so nothing can be matched.",
      "Check that the download client is the one holding these downloads, then re-run the doctor.",
    );
  }
  return evaluateOrphans(selectOrphans(entries, torrents, Date.now()));
}
