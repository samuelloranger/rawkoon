import { notifyAdminsLibraryGrabSkipped as notifyStructured } from "@rawkoon/api/workers/notifyLibraryEvents";

export async function notifyAdminsLibraryGrabSkipped(
  bodyOrOpts: string | Parameters<typeof notifyStructured>[0],
  mediaId?: number,
): Promise<void> {
  if (typeof bodyOrOpts === "string") {
    if (mediaId == null) return;
    await notifyStructured({
      mediaId,
      reason: bodyOrOpts,
      scope: "movie",
    });
    return;
  }
  await notifyStructured(bodyOrOpts);
}
