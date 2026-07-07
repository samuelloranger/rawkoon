import { normalizeNotificationUrl } from "@rawkoon/shared/utils";
function getNotificationTargetUrl(
  url: string | null | undefined,
  fallback = "/notifications",
): string {
  return normalizeNotificationUrl(url) ?? fallback;
}

export function openNotificationTarget(
  url: string | null | undefined,
  fallback = "/notifications",
): void {
  window.location.assign(getNotificationTargetUrl(url, fallback));
}
