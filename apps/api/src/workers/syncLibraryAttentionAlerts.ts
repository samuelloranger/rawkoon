import { healWantedWithFiles } from "@rawkoon/api/services/library/healWantedWithFiles";
import { syncLibraryAttentionAlerts } from "@rawkoon/api/services/libraryAttention/libraryAttentionSync";

export async function runSyncLibraryAttentionAlerts(): Promise<void> {
  // A heal failure must never skip the attention sync.
  try {
    const healed = await healWantedWithFiles();
    if (healed > 0) {
      console.log(
        `[syncLibraryAttentionAlerts] healed ${healed} wanted with a file`,
      );
    }
  } catch (error) {
    console.warn("[syncLibraryAttentionAlerts] heal failed:", error);
  }
  const r = await syncLibraryAttentionAlerts();
  console.log(
    `[syncLibraryAttentionAlerts] created=${r.created} updated=${r.updated} resolved=${r.resolved}`,
  );
}
