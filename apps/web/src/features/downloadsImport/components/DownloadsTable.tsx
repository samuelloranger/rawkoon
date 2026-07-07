import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownZA, ArrowUpAZ, RotateCw } from "lucide-react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  DownloadRow,
  ROW_GRID_TEMPLATE,
} from "@/features/downloadsImport/components/DownloadRow";
import type { DownloadListRow } from "@/features/downloadsImport/hooks/useDownloadsImport";
import type {
  RowPhase,
  StagedPick,
} from "@/features/downloadsImport/hooks/useStagedQueue";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "ready" | "linked" | "parse_failed";
type SortDir = "size_desc" | "name_asc" | "mtime_desc";

function filterAndSort(
  items: DownloadListRow[],
  filenameSub: string,
  statusFilter: StatusFilter,
  sortDir: SortDir,
): DownloadListRow[] {
  let rows = items;
  const sub = filenameSub.trim().toLowerCase();
  if (sub || statusFilter !== "all") {
    rows = rows.filter((r) => {
      if (sub && !r.file_name.toLowerCase().includes(sub)) return false;
      if (statusFilter === "ready")
        return !r.is_imported && r.parsed.title != null;
      if (statusFilter === "linked") return r.is_imported;
      if (statusFilter === "parse_failed")
        return !r.is_imported && r.parsed.title == null;
      return true;
    });
  }
  const sorted = rows.slice();
  if (sortDir === "size_desc")
    sorted.sort((a, b) => b.size_bytes - a.size_bytes);
  else if (sortDir === "name_asc")
    sorted.sort((a, b) => a.file_name.localeCompare(b.file_name));
  else
    sorted.sort(
      (a, b) =>
        new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime(),
    );
  return sorted;
}

export function DownloadsTable({
  items,
  stagedByPath,
  rowPhase,
  rowError,
  popoverPath,
  onSetPopoverPath,
  onPick,
  onUnstage,
  onRetry,
  batchRunning,
}: {
  items: DownloadListRow[];
  stagedByPath: Record<string, StagedPick>;
  rowPhase: Record<string, RowPhase>;
  rowError: Record<string, string>;
  popoverPath: string | null;
  onSetPopoverPath: (p: string | null) => void;
  onPick: (row: DownloadListRow, item: TmdbMediaSearchItem) => void;
  onUnstage: (path: string) => void;
  onRetry: (path: string) => void;
  batchRunning: boolean;
}) {
  const { t } = useTranslation("common");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [filenameSub, setFilenameSub] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("size_desc");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const visible = useMemo(
    () => filterAndSort(items, filenameSub, statusFilter, sortDir),
    [items, filenameSub, statusFilter, sortDir],
  );

  const handleToggleExpand = useCallback((path: string) => {
    setExpanded((e) => ({ ...e, [path]: !e[path] }));
  }, []);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useEffect(() => {
    const update = () => {
      const el = parentRef.current;
      if (!el) return;
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [visible.length]);

  const estimateSize = useCallback(
    (index: number) => (expanded[visible[index]!.file_path] ? 140 : 38),
    [expanded, visible],
  );

  const rowVirtualizer = useWindowVirtualizer({
    count: visible.length,
    estimateSize,
    overscan: 8,
    scrollMargin,
    getItemKey: (index) => visible[index]!.file_path,
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={filenameSub}
          onChange={(e) => setFilenameSub(e.target.value)}
          placeholder={t("downloadsImport.toolbar.filenameFilter")}
          className="flex-1 min-w-[160px] sm:max-w-xs rounded-xl border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-xl border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs"
        >
          <option value="all">{t("downloadsImport.toolbar.statusAll")}</option>
          <option value="ready">
            {t("downloadsImport.toolbar.statusReady")}
          </option>
          <option value="linked">
            {t("downloadsImport.toolbar.statusLinked")}
          </option>
          <option value="parse_failed">
            {t("downloadsImport.toolbar.statusParseFailed")}
          </option>
        </select>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs"
          onClick={() =>
            setSortDir((d) =>
              d === "size_desc"
                ? "name_asc"
                : d === "name_asc"
                  ? "mtime_desc"
                  : "size_desc",
            )
          }
          title={
            sortDir === "size_desc"
              ? t("downloadsImport.toolbar.sortingSize")
              : sortDir === "name_asc"
                ? t("downloadsImport.toolbar.sortingName")
                : t("downloadsImport.toolbar.sortingModified")
          }
        >
          {sortDir === "size_desc" ? (
            <ArrowDownZA size={14} />
          ) : sortDir === "name_asc" ? (
            <ArrowUpAZ size={14} />
          ) : (
            <RotateCw size={14} />
          )}
          {t("downloadsImport.toolbar.sort")}
        </button>
        <span className="text-xs text-neutral-500 ml-auto">
          {t("downloadsImport.toolbar.count", {
            visible: visible.length,
            total: items.length,
          })}
        </span>
      </div>

      {visible.length > 0 && (
        <div
          ref={parentRef}
          className="rounded-xl border border-neutral-700 overflow-hidden"
        >
          <div
            className={cn(
              ROW_GRID_TEMPLATE,
              "bg-white/[0.04] text-xs font-semibold uppercase tracking-wide text-neutral-500 px-2 py-2 gap-x-2 sticky top-0 z-10",
            )}
          >
            <div />
            <div>{t("downloadsImport.columns.file")}</div>
            <div>{t("downloadsImport.columns.size")}</div>
            <div>{t("downloadsImport.columns.quality")}</div>
            <div className="hidden md:block">
              {t("downloadsImport.columns.group")}
            </div>
            <div>{t("downloadsImport.columns.status")}</div>
            <div className="text-right">
              {t("downloadsImport.columns.actions")}
            </div>
          </div>
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = visible[vi.index]!;
              const path = row.file_path;
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start - rowVirtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <DownloadRow
                    row={row}
                    expanded={!!expanded[path]}
                    staged={stagedByPath[path]}
                    phase={rowPhase[path]}
                    error={rowError[path]}
                    popoverOpen={popoverPath === path}
                    batchRunning={batchRunning}
                    onToggleExpand={handleToggleExpand}
                    onSetPopoverPath={onSetPopoverPath}
                    onPick={onPick}
                    onUnstage={onUnstage}
                    onRetry={onRetry}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
