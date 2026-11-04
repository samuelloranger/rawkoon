import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Download,
  Inbox,
  Sparkles,
  Upload,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  NOTIFICATION_PREFERENCE_KEYS,
  type NotificationPreferenceKey,
  type NotificationPreferences,
  resolveNotificationPreference,
} from "@rawkoon/shared/types/notificationPreferences";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { useFetcher } from "@/lib/api/context";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export const NOTIFICATION_PREFERENCE_GROUPS: {
  id: "library" | "books" | "requests" | "other";
  keys: Partial<Record<NotificationPreferenceKey, LucideIcon>>;
}[] = [
  {
    id: "library",
    keys: {
      library_downloaded: Download,
      library_grabbed: Upload,
      library_failed: AlertTriangle,
      library_grab_skipped: AlertTriangle,
      library_attention: AlertTriangle,
      download_client_offline: WifiOff,
    },
  },
  {
    id: "books",
    keys: {
      book_downloaded: BookOpen,
      book_grabbed: BookOpen,
      book_failed: AlertTriangle,
      book_search_skipped: AlertTriangle,
      book_author_releases: BookOpen,
    },
  },
  {
    id: "requests",
    keys: {
      request_pending: Inbox,
      request_decided: Inbox,
      request_available: Inbox,
    },
  },
  {
    id: "other",
    keys: {
      movie_release_reminder: Bell,
      app_update: Sparkles,
      github_release: Sparkles,
    },
  },
];

export function NotificationPreferencesSection() {
  const { t } = useTranslation("common");
  const { data: user } = useCurrentUser();
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  const prefs = user?.notification_preferences ?? {};

  const toggle = async (key: NotificationPreferenceKey) => {
    const next: NotificationPreferences = {
      ...prefs,
      [key]: !resolveNotificationPreference(prefs, key),
    };
    try {
      await fetcher("/api/users/me/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ notification_preferences: next }),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.auth.me,
      });
      toast.success(t("settings.notifications.preferencesSaved"));
    } catch {
      toast.error(t("settings.notifications.preferencesError"));
    }
  };

  return (
    <div className="rounded-xl border border-neutral-700/60 bg-neutral-900/40 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">
          {t("settings.notifications.preferencesTitle")}
        </h3>
        <p className="text-xs text-neutral-400 mt-1">
          {t("settings.notifications.preferencesDescription")}
        </p>
      </div>
      {NOTIFICATION_PREFERENCE_GROUPS.map((group) => (
        <div key={group.id} className="space-y-1">
          <h4 className="px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t(`settings.notifications.groups.${group.id}`)}
          </h4>
          {NOTIFICATION_PREFERENCE_KEYS.filter((key) => key in group.keys).map(
            (key) => {
              const Icon = group.keys[key] ?? Bell;
              const enabled = resolveNotificationPreference(prefs, key);
              return (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03] cursor-pointer"
                >
                  <span className="flex items-center gap-2 text-sm text-neutral-200">
                    <Icon className="h-4 w-4 text-neutral-400" />
                    {t(`settings.notifications.types.${key}`)}
                  </span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggle(key)}
                    className="h-4 w-4 rounded border-neutral-600"
                  />
                </label>
              );
            },
          )}
        </div>
      ))}
    </div>
  );
}
