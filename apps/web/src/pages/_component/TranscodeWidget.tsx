import { Link } from "@tanstack/react-router";
import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TranscodeJob, TranscodeQueueState } from "@rawkoon/shared/types";
import { formatBytes, formatDuration } from "@/features/transcode/format";
import { useTranscodeSummary } from "@/features/transcode/hooks";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { cn } from "@/lib/utils";
import { WidgetHeader, WidgetShell } from "@/pages/_component/widgetPrimitives";

function StatePill({
  state,
  windowStart,
}: {
  state: TranscodeQueueState;
  windowStart: string;
}) {
  const { t } = useTranslation("common");
  const cls = {
    running: "bg-emerald-500/10 text-emerald-300",
    paused: "bg-amber-400/10 text-amber-300",
    waiting_window: "bg-sky-400/10 text-sky-300",
    idle: "bg-neutral-800 text-neutral-400",
  }[state];
  const label = {
    running: t("transcode.widget.running"),
    paused: t("transcode.widget.paused"),
    waiting_window: t("transcode.widget.waits", { time: windowStart }),
    idle: t("transcode.widget.idle"),
  }[state];
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}
    >
      {label}
    </span>
  );
}

function codecLine(j: TranscodeJob): string {
  return `${j.settings.codec.toUpperCase()} · ${j.settings.encoder === "vaapi" ? "GPU" : "CPU"}`;
}

export function TranscodeWidget() {
  const { t } = useTranslation("common");
  const { data: user } = useCurrentUser();
  const isAdmin = user?.is_admin === true;
  const { data } = useTranscodeSummary(isAdmin);
  if (!isAdmin || !data?.show) return null;
  const cur = data.current;
  const remaining = data.queued_count - data.next.length;

  return (
    <WidgetShell>
      <WidgetHeader
        icon={Gauge}
        title={t("transcode.widget.title")}
        right={<StatePill state={data.state} windowStart={data.window_start} />}
      />
      <div className="px-3.5 py-3">
        {cur ? (
          <div className="flex items-start gap-2.5">
            {cur.poster_url ? (
              <img
                src={cur.poster_url}
                alt=""
                className="h-[50px] w-[34px] flex-none rounded object-cover"
              />
            ) : (
              <div className="h-[50px] w-[34px] flex-none rounded bg-neutral-800" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-neutral-50">
                {cur.title}
              </div>
              <div className="text-xs text-neutral-500">{codecLine(cur)}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-950">
                <i
                  className="block h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-400"
                  style={{
                    width: `${Math.round((cur.live?.progress ?? cur.progress ?? 0) * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-neutral-400">
                <span>
                  {Math.round((cur.live?.progress ?? cur.progress ?? 0) * 100)}%
                  {cur.live?.fps ? ` · ${Math.round(cur.live.fps)} fps` : ""}
                </span>
                {cur.live?.eta_secs != null && (
                  <span>
                    {t("transcode.widget.left", {
                      time: formatDuration(cur.live.eta_secs),
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-neutral-400">
            {t("transcode.widget.queued", { count: data.queued_count })}
          </div>
        )}
        {data.next.length > 0 && (
          <div className="mt-3 grid gap-1 text-xs">
            {data.next.map((j) => (
              <div key={j.id} className="flex justify-between text-neutral-400">
                <span className="truncate">{j.title}</span>
                <span className="font-mono">{formatBytes(j.source_bytes)}</span>
              </div>
            ))}
            {remaining > 0 && (
              <div className="flex justify-between text-neutral-500">
                <span>{t("transcode.widget.more", { count: remaining })}</span>
                <span className="font-mono">
                  {t("transcode.widget.total", {
                    time: formatDuration(data.queued_eta_secs),
                  })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-neutral-800 px-3.5 py-2.5 text-xs">
        <span className="text-emerald-300">
          {t("transcode.widget.saved", {
            size: formatBytes(data.saved_bytes_30d),
            count: data.done_count_30d,
          })}
          {data.failed_count > 0 && (
            <span className="ml-2 text-red-400">
              {t("transcode.widget.failed", { count: data.failed_count })}
            </span>
          )}
        </span>
        <Link
          to="/settings"
          search={{ tab: "transcode" }}
          className="font-semibold text-primary-400"
        >
          {t("transcode.widget.manage")}
        </Link>
      </div>
    </WidgetShell>
  );
}
