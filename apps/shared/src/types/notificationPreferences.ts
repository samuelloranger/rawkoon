/** Per-type opt-out toggles; omitted keys default to enabled. */
export type NotificationPreferenceKey =
  | "library_downloaded"
  | "library_grabbed"
  | "library_failed"
  | "library_grab_skipped"
  | "library_attention"
  | "book_downloaded"
  | "book_grabbed"
  | "book_failed"
  | "book_search_skipped"
  | "book_author_releases"
  | "request_pending"
  | "request_decided"
  | "request_available"
  | "movie_release_reminder"
  | "app_update"
  | "github_release";

export type NotificationPreferences = Partial<
  Record<NotificationPreferenceKey, boolean>
>;

export const NOTIFICATION_PREFERENCE_KEYS: NotificationPreferenceKey[] = [
  "library_downloaded",
  "library_grabbed",
  "library_failed",
  "library_grab_skipped",
  "library_attention",
  "book_downloaded",
  "book_grabbed",
  "book_failed",
  "book_search_skipped",
  "book_author_releases",
  "request_pending",
  "request_decided",
  "request_available",
  "movie_release_reminder",
  "app_update",
  "github_release",
];

export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  NotificationPreferenceKey,
  boolean
> = Object.fromEntries(
  NOTIFICATION_PREFERENCE_KEYS.map((k) => [k, true]),
) as Record<NotificationPreferenceKey, boolean>;

export function resolveNotificationPreference(
  prefs: NotificationPreferences | null | undefined,
  key: NotificationPreferenceKey,
): boolean {
  if (prefs == null) return true;
  return prefs[key] !== false;
}
