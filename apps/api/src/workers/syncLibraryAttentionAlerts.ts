import { syncLibraryAttentionAlerts } from "@rawkoon/api/services/libraryAttentionSync";

export async function runSyncLibraryAttentionAlerts(): Promise<void> {
  const r = await syncLibraryAttentionAlerts();
  console.log(
    `[syncLibraryAttentionAlerts] created=${r.created} updated=${r.updated} resolved=${r.resolved}`,
  );
}
