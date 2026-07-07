import { useTranslation } from "react-i18next";
import { Film, MonitorPlay, Pause } from "lucide-react";
import { WidgetShell, WidgetHeader } from "@/pages/_component/widgetPrimitives";
import { useNowWatching } from "@/pages/_component/useNowWatching";

const clamp = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Compact "Now watching" widget backed by live Jellyfin playback sessions
 * (polled every 15s). Renders nothing when Jellyfin isn't configured (the
 * response reports `enabled: false`), a quiet placeholder when nobody is
 * watching, and one progress row per active session otherwise. Designed to
 * sit in a narrow dashboard grid column — vertical list, no horizontal scroll.
 */
export function NowWatchingWidget() {
  const { t } = useTranslation("common");
  const { data } = useNowWatching();

  // Render nothing until the first response lands, then hide the widget
  // entirely when Jellyfin is disabled. This keeps it invisible (rather than
  // flashing an empty placeholder) before data settles.
  if (!data || data.enabled === false) return null;

  const sessions = data.sessions;
  const hasSessions = sessions.length > 0;

  return (
    <WidgetShell>
      <WidgetHeader
        icon={MonitorPlay}
        title={t("dashboard.home.nowWatching")}
        right={
          hasSessions ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-500 animate-pulse" />
              <span className="text-xs text-neutral-400">
                {sessions.length}
              </span>
            </span>
          ) : undefined
        }
      />

      {!hasSessions ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-500">
          {t("dashboard.home.nowWatchingEmpty")}
        </p>
      ) : (
        <div className="divide-y divide-neutral-800/60">
          {sessions.map((session) => {
            const pct = clamp(session.progress_pct);
            return (
              <div
                key={session.session_id}
                className={`flex gap-3 px-4 py-3 ${session.paused ? "opacity-70" : ""}`}
              >
                <div className="flex h-16 w-[3rem] shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-800">
                  {session.poster_url ? (
                    <img
                      src={session.poster_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Film className="h-5 w-5 text-neutral-600" aria-hidden />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-100">
                    {session.title}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {session.device
                      ? `${session.user} · ${session.device}`
                      : session.user}
                  </p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-primary-500"
                      style={{ width: `${pct}%` }}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  </div>
                </div>

                {session.paused ? (
                  <Pause
                    className="h-4 w-4 shrink-0 self-center text-neutral-400"
                    aria-label={t("dashboard.home.paused")}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
