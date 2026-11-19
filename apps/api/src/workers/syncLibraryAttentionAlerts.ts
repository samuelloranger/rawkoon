import { healWantedWithFiles } from "@rawkoon/api/services/library/healWantedWithFiles";
import { syncLibraryAttentionAlerts } from "@rawkoon/api/services/libraryAttention/libraryAttentionSync";

export async function runSyncLibraryAttentionAlerts(): Promise<void> {
  const healed = await healWantedWithFiles();
  if (healed > 0) {
    console.log(
      `[syncLibraryAttentionAlerts] healed ${healed} wanted with a file`,
    );
  }
  const r = await syncLibraryAttentionAlerts();
  console.log(
    `[syncLibraryAttentionAlerts] created=${r.created} updated=${r.updated} resolved=${r.resolved}`,
  );
}
