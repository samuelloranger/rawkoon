import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Rss, CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS, ADMIN_ENDPOINTS } from "@/lib/endpoints";
import {
  Kicker,
  WidgetHeader,
  WidgetShell,
} from "@/pages/_component/widgetPrimitives";
import type { RssStatusResponse } from "@rawkoon/shared/types";

// ─── Hook ─────────────────────────────────────────────────────────────────────

function useRssStatus(refetchInterval = 15_000) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.rssStatus(),
    queryFn: () => fetcher<RssStatusResponse>(LIBRARY_ENDPOINTS.RSS_STATUS),
    staleTime: 0,
    refetchInterval,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(isoString: string, now: number): string {
  const diff = Math.max(
    0,
    Math.round((now - new Date(isoString).getTime()) / 1000),
  );
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function formatCountdown(isoString: string, now: number): string {
  const diff = Math.round((new Date(isoString).getTime() - now) / 1000);
  if (diff <= 0) return "";
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  if (mins === 0) return `${secs}s`;
  return `in ${mins}m ${String(secs).padStart(2, "0")}s`;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function RssStatusPanel() {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();

  const [isPolling, setIsPolling] = useState(false);
  const [triggeredAt, setTriggeredAt] = useState<number | null>(null);
  const snapshotRef = useRef<string | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useRssStatus(isPolling ? 2_000 : 15_000);
  const lastRun = data?.last_run ?? null;
  const nextRunAt = data?.next_run_at ?? null;
  const completedAt = lastRun?.completed_at ?? null;
  const releasesFound = lastRun?.releases_found ?? 0;

  const clockOffsetRef = useRef(0);
  const [alignedNow, setAlignedNow] = useState(0);

  useLayoutEffect(() => {
    const tick = () => {
      setAlignedNow(Date.now() + clockOffsetRef.current);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!data?.server_time) return;
    clockOffsetRef.current = new Date(data.server_time).getTime() - Date.now();
    setAlignedNow(Date.now() + clockOffsetRef.current);
  }, [data?.server_time]);

  const now = alignedNow;

  useEffect(() => {
    return () => {
      if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
    };
  }, []);

  // Detect job completion by watching for a new completed_at.
  // setState is deferred into a setTimeout callback to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!isPolling || !snapshotRef.current) return;
    if (!completedAt || completedAt === snapshotRef.current) return;
    if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
    const count = releasesFound;
    const id = setTimeout(() => {
      setIsPolling(false);
      if (count > 0) {
        toast.success(t("dashboard.rss.toastFound", { count }));
      } else {
        toast(t("dashboard.rss.toastNone"));
      }
    }, 0);
    return () => clearTimeout(id);
  }, [completedAt, releasesFound, isPolling, t]);

  const triggerRss = useMutation({
    mutationFn: () =>
      fetcher<{ success: boolean }>(ADMIN_ENDPOINTS.TRIGGER_ACTION, {
        method: "POST",
        body: { action: "poll_indexer_rss" },
      }),
    onSuccess: () => {
      setIsPolling(true);
      setTriggeredAt(Date.now() + clockOffsetRef.current);
      pollingTimeoutRef.current = setTimeout(() => setIsPolling(false), 60_000);
    },
  });

  const isExecuting = nextRunAt ? now >= new Date(nextRunAt).getTime() : false;
  const isCoolingDown = triggeredAt !== null && now - triggeredAt < 30_000;
  const cooldownSecsLeft =
    triggeredAt !== null
      ? Math.ceil((30_000 - (now - triggeredAt)) / 1_000)
      : 0;
  const buttonDisabled = isCoolingDown || isPolling || triggerRss.isPending;

  return (
    <WidgetShell>
      <WidgetHeader
        icon={Rss}
        title={t("dashboard.rss.title")}
        right={
          <button
            onClick={() => {
              snapshotRef.current = completedAt;
              triggerRss.mutate();
            }}
            disabled={buttonDisabled}
            aria-label={t("dashboard.rss.checkNow")}
            className="flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-primary-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPolling ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            <span>
              {isPolling
                ? t("dashboard.rss.checking")
                : isCoolingDown
                  ? `${cooldownSecsLeft}s`
                  : t("dashboard.rss.checkNow")}
            </span>
          </button>
        }
      />

      <div className="px-4 py-3 space-y-3">
        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="h-2 w-16 rounded-full bg-neutral-800 animate-pulse" />
              <div className="flex items-center justify-between gap-3">
                <div className="h-3.5 w-20 rounded bg-neutral-800 animate-pulse" />
                <div className="h-5 w-14 rounded-full bg-neutral-800 animate-pulse" />
              </div>
              <div className="h-2.5 w-40 rounded-full bg-neutral-800 animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-2 w-10 rounded-full bg-neutral-800 animate-pulse" />
              <div className="h-3.5 w-16 rounded bg-neutral-800 animate-pulse" />
            </div>
          </div>
        )}

        {/* Last run */}
        {!isLoading && (
          <div>
            <Kicker>{t("dashboard.rss.lastRun")}</Kicker>
            {!lastRun && (
              <p className="mt-1 text-sm text-neutral-400">
                {t("dashboard.rss.neverRan")}
              </p>
            )}
            {lastRun && (
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-neutral-200 font-mono tabular-nums">
                    {formatRelative(lastRun.completed_at, now)}
                  </span>
                  {lastRun.status === "success" ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-900/30 rounded-full px-2 py-0.5">
                      <CheckCircle2 size={10} />
                      {t("dashboard.rss.statusOk")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-rose-300 bg-rose-900/30 rounded-full px-2 py-0.5">
                      <XCircle size={10} />
                      {t("dashboard.rss.statusError")}
                    </span>
                  )}
                </div>
                {lastRun.status === "error" && lastRun.error && (
                  <p
                    className="text-xs text-rose-400 truncate"
                    title={lastRun.error}
                  >
                    {lastRun.error}
                  </p>
                )}
                {lastRun.status === "success" && (
                  <p className="text-xs text-neutral-400">
                    {t("dashboard.rss.releasesFound", {
                      count: lastRun.releases_found,
                    })}
                    {lastRun.releases_grabbed > 0 && (
                      <>
                        {" "}
                        ·{" "}
                        <span className="text-sky-400 font-medium">
                          {t("dashboard.rss.releasesGrabbed", {
                            count: lastRun.releases_grabbed,
                          })}
                          {lastRun.releases_grabbed_by_ai > 0 && (
                            <>
                              {" "}
                              (
                              {t("dashboard.rss.releasesGrabbedByAi", {
                                count: lastRun.releases_grabbed_by_ai,
                              })}
                              )
                            </>
                          )}
                        </span>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Per-indexer breakdown */}
        {!isLoading && lastRun && lastRun.indexers.length > 0 && (
          <div>
            <Kicker>{t("dashboard.rss.indexers")}</Kicker>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {lastRun.indexers.map((idx) => (
                <span key={idx.name} className="text-xs text-neutral-300">
                  <span className="font-medium">{idx.name}</span>
                  <span className="font-mono tabular-nums text-neutral-400">
                    {" "}
                    {idx.releases_found}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Next run */}
        {!isLoading && nextRunAt && (
          <div>
            <Kicker>{t("dashboard.rss.nextRun")}</Kicker>
            {isExecuting ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-primary-400 font-medium">
                <Loader2 size={13} className="animate-spin" />
                {t("dashboard.rss.executing")}
              </p>
            ) : (
              <p className="mt-1 text-sm font-mono tabular-nums text-neutral-200">
                {formatCountdown(nextRunAt, now)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <Link
        to="/library"
        className="block px-4 py-2.5 text-xs font-medium text-neutral-400 hover:text-primary-400 transition-colors border-t border-neutral-800 text-center"
      >
        {t("dashboard.rss.openLibraryLink")}
      </Link>
    </WidgetShell>
  );
}
