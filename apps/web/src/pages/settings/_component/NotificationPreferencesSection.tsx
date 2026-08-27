import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  NOTIFICATION_PREFERENCE_KEYS,
  type NotificationPreferenceKey,
  type NotificationPreferences,
  resolveNotificationPreference,
} from "@rawkoon/shared/types/notificationPreferences";
import { notificationPreferenceLabels } from "@/components/NotificationLeadingVisual";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { useFetcher } from "@/lib/api/context";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function NotificationPreferencesSection() {
  const { t, i18n } = useTranslation("common");
  const { data: user } = useCurrentUser();
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";

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
      <div className="space-y-2">
        {NOTIFICATION_PREFERENCE_KEYS.map((key) => {
          const meta = notificationPreferenceLabels[key];
          const Icon = meta?.icon;
          const enabled = resolveNotificationPreference(prefs, key);
          return (
            <label
              key={key}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03] cursor-pointer"
            >
              <span className="flex items-center gap-2 text-sm text-neutral-200">
                {Icon ? <Icon className="h-4 w-4 text-neutral-400" /> : null}
                {meta ? meta[lang] : key}
              </span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={() => toggle(key)}
                className="h-4 w-4 rounded border-neutral-600"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
