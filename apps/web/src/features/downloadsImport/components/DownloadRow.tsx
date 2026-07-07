import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  DownloadListRow,
  DownloadParsed,
} from "@/features/downloadsImport/hooks/useDownloadsImport";
import type {
  RowPhase,
  StagedPick,
} from "@/features/downloadsImport/hooks/useStagedQueue";
import { StatusBadge } from "@/features/downloadsImport/components/StatusBadge";
import { ReleaseDetails } from "@/features/downloadsImport/components/ReleaseDetails";
import { TmdbAssignPopover } from "@/features/downloadsImport/components/TmdbAssignPopover";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Shared CSS grid template — keep in sync with the header row in DownloadsTable. */
export const ROW_GRID_TEMPLATE =
  "grid grid-cols-[2rem_minmax(0,1fr)_4.5rem_4rem_6rem_9rem_auto] md:grid-cols-[2rem_minmax(0,1fr)_5rem_5rem_7rem_10rem_minmax(0,16rem)]";

type DownloadRowProps = {
  row: DownloadListRow;
  expanded: boolean;
  staged: StagedPick | undefined;
  phase: RowPhase | undefined;
  error: string | undefined;
  popoverOpen: boolean;
  batchRunning: boolean;
  /** Stable callbacks from parent. The row binds them to its own `file_path`. */
  onToggleExpand: (path: string) => void;
  onSetPopoverPath: (path: string | null) => void;
  onPick: (row: DownloadListRow, item: TmdbMediaSearchItem) => void;
  onUnstage: (path: string) => void;
  onRetry: (path: string) => void;
};

function DownloadRowImpl({
  row,
  expanded,
  staged,
  phase,
  error,
  popoverOpen,
  batchRunning,
  onToggleExpand,
  onSetPopoverPath,
  onPick,
  onUnstage,
  onRetry,
}: DownloadRowProps) {
  const { t } = useTranslation("common");
  const path = row.file_path;
  const parsed: DownloadParsed = row.parsed;
  const isGrey = row.is_imported || phase === "success";

  const handleToggleExpand = useCallback(
    () => onToggleExpand(path),
    [onToggleExpand, path],
  );
  const handlePopoverOpenChange = useCallback(
    (open: boolean) => onSetPopoverPath(open ? path : null),
    [onSetPopoverPath, path],
  );
  const handlePick = useCallback(
    (item: TmdbMediaSearchItem) => onPick(row, item),
    [onPick, row],
  );
  const handleUnstage = useCallback(() => onUnstage(path), [onUnstage, path]);
  const handleRetry = useCallback(() => onRetry(path), [onRetry, path]);
  const handleEdit = useCallback(
    () => onSetPopoverPath(path),
    [onSetPopoverPath, path],
  );

  return (
    <div className={cn("border-t border-white/[0.06]", isGrey && "opacity-55")}>
      <div
        className={cn(
          ROW_GRID_TEMPLATE,
          "items-center text-sm py-1.5 pl-2 pr-3 gap-x-2",
        )}
      >
        <div>
          <button
            type="button"
            className="p-1 hover:bg-white/10 rounded"
            onClick={handleToggleExpand}
            aria-label={
              expanded
                ? t("downloadsImport.row.collapse")
                : t("downloadsImport.row.expand")
            }
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
        <div className="font-medium text-white truncate">{row.file_name}</div>
        <div className="text-neutral-300 whitespace-nowrap text-xs sm:text-sm">
          {formatBytes(row.size_bytes)}
        </div>
        <div className="text-neutral-500 text-xs">{parsed.quality ?? "—"}</div>
        <div className="text-neutral-500 truncate text-xs hidden md:block">
          {parsed.release_group ?? "—"}
        </div>
        <div className="flex items-center gap-1">
          <StatusBadge row={row} />
          {phase === "submitting" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" />
          )}
          {phase === "success" && <span className="text-green-600">✓</span>}
          {phase === "error" && <span className="text-red-600">✗</span>}
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {staged && (
            <>
              <div className="flex items-center gap-1 rounded-full border border-primary-600/40 bg-primary-600/[0.08] px-2 py-0.5 max-w-[10rem]">
                {staged.poster_url && (
                  <img
                    src={staged.poster_url}
                    alt=""
                    className="h-6 w-4 rounded-sm object-cover"
                  />
                )}
                <span className="truncate text-[11px] font-medium">
                  {staged.preview_title}
                  {typeof staged.preview_year === "number" &&
                  Number.isFinite(staged.preview_year)
                    ? ` · ${staged.preview_year}`
                    : ""}
                </span>
                <button
                  type="button"
                  className="p-0.5 text-neutral-500 hover:text-red-600"
                  onClick={handleUnstage}
                  aria-label={t("downloadsImport.row.unstage")}
                >
                  <X size={12} />
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={handleEdit}
              >
                {t("downloadsImport.row.edit")}
              </Button>
              {phase === "error" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={handleRetry}
                  disabled={batchRunning}
                >
                  {t("downloadsImport.row.retry")}
                </Button>
              )}
            </>
          )}
          {error && (
            <span
              className="text-[10px] text-red-600 truncate max-w-[10rem]"
              title={error}
            >
              {error}
            </span>
          )}
          <TmdbAssignPopover
            row={row}
            open={popoverOpen}
            onOpenChange={handlePopoverOpenChange}
            onPick={handlePick}
          />
        </div>
      </div>
      {expanded && <ReleaseDetails row={row} />}
    </div>
  );
}

export const DownloadRow = memo(DownloadRowImpl);
