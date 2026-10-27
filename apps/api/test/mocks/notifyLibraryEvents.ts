import { mock } from "bun:test";

/** Every notifyLibraryEvents export as a spy, so grab tests make the notification step explicit. */
export function makeNotifyLibraryEventsMock() {
  const fns = {
    notifyAdminsMediaDownloaded: mock(async (..._: unknown[]) => {}),
    notifyAdminsLibraryGrabbed: mock(async (..._: unknown[]) => {}),
    notifyAdminsLibraryDownloadFailed: mock(async (..._: unknown[]) => {}),
    notifyAdminsPostProcessFailed: mock(async (..._: unknown[]) => {}),
    notifyAdminsLibraryGrabSkipped: mock(async (..._: unknown[]) => {}),
    notifyAdminsLibraryGrabSkippedLegacy: mock(async (..._: unknown[]) => {}),
    notifyAdminsLibraryAttentionAlert: mock(async (..._: unknown[]) => {}),
  };
  return fns;
}
