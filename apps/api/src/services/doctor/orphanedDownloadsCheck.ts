import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { evaluateOrphans, selectOrphans } from "./orphanedDownloads";
import { readLibraryInodes, scanDownloads } from "./probes";
import type { CheckOutcome } from "./status";

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
  // Without the client's torrent list every entry would look orphaned.
  const torrents = await resolveActiveAdapter()
    .then((active) => active?.adapter.listTorrents() ?? null)
    .catch(() => null);
  if (!torrents) {
    return {
      status: "warn",
      summary: "Could not check: the download client is unreachable.",
      fix: "Check the download client under Settings, then re-run the doctor.",
    };
  }
  const entries = await scanDownloads(downloadsPath, await readLibraryInodes());
  return evaluateOrphans(selectOrphans(entries, torrents, Date.now()));
}
