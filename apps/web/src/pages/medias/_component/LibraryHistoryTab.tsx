import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useGlobalDownloadHistory } from "@/features/medias/hooks/useGlobalDownloadHistory";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Card } from "./LibrarySharedUI";
import { StatsSection } from "./LibraryHistoryStats";
import {
  HistoryRow,
  type StatusFilter,
  type DaysFilter,
} from "./LibraryHistoryRow";

const panelClassName =
  "rounded-lg border border-neutral-700/60 bg-neutral-900/50";

// ─── Main export ───────────────────────────────────────────────────────────────

export function LibraryHistoryTab() {
  const { t } = useTranslation("common");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [days, setDays] = useState<DaysFilter>(30);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useGlobalDownloadHistory({
    page,
    status: status !== "all" ? status : undefined,
    days: days > 0 ? days : undefined,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.has_more ?? false;
  const limit = data?.limit ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const statusOptions: { id: StatusFilter; label: string }[] = [
    { id: "all", label: t("medias.history.statusAll") },
    { id: "completed", label: t("medias.history.statusCompleted") },
    { id: "failed", label: t("medias.history.statusFailed") },
    { id: "active", label: t("medias.history.statusActive") },
  ];

  const handleStatusChange = (s: StatusFilter) => {
    setStatus(s);
    setPage(1);
  };
  const handleDaysChange = (d: number) => {
    setDays(d as DaysFilter);
    setPage(1);
  };

  return (
    <Card className="animate-in fade-in slide-in-from-right-4 duration-300 border-neutral-700 bg-neutral-800">
      <div className="px-6 py-4 border-b border-neutral-700/60">
        <h2 className="text-sm font-semibold text-neutral-100">
          {t("settings.mediaHistory.title")}
        </h2>
        <p className="text-xs text-neutral-400 mt-0.5">
          {t("settings.mediaHistory.description")}
        </p>
      </div>

      <div className="p-4 space-y-4">
        <StatsSection />

        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={status}
            onValueChange={(value) => handleStatusChange(value as StatusFilter)}
          >
            <SelectTrigger className="w-40 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(days)}
            onValueChange={(value) => handleDaysChange(Number(value))}
          >
            <SelectTrigger className="w-40 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t("medias.history.days7")}</SelectItem>
              <SelectItem value="30">{t("medias.history.days30")}</SelectItem>
              <SelectItem value="90">{t("medias.history.days90")}</SelectItem>
              <SelectItem value="0">{t("medias.history.daysAll")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card
          className={cn(
            panelClassName,
            "overflow-hidden divide-y divide-neutral-800",
          )}
        >
          {isLoading ? (
            <div className="space-y-px">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded bg-neutral-800 animate-pulse" />
                    <div className="h-2.5 w-56 rounded bg-neutral-800 animate-pulse" />
                  </div>
                  <div className="h-5 w-14 rounded-full bg-neutral-800 animate-pulse" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-neutral-400">
              {t("medias.history.empty")}
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {items.map((item) => (
                <HistoryRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-400">
              {t("medias.history.paginationRange", {
                start: (page - 1) * limit + 1,
                end: Math.min(page * limit, total),
                total,
              })}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1}
                className="rounded-lg p-1.5 text-neutral-500 transition-colors disabled:opacity-40 hover:text-neutral-300"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[60px] text-center text-xs text-neutral-400">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
                className="rounded-lg p-1.5 text-neutral-500 transition-colors disabled:opacity-40 hover:text-neutral-300"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
