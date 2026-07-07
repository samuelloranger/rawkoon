import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, Clock, Film, Tv } from "lucide-react";
import { Link } from "@tanstack/react-router";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeShort(isoString: string): string {
  const diff = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Filter types ─────────────────────────────────────────────────────────────

export type StatusFilter = "all" | "completed" | "failed" | "active";
export type DaysFilter = 0 | 7 | 30 | 90;

// ─── History row ───────────────────────────────────────────────────────────────

export function HistoryRow({
  item,
}: {
  item: {
    id: number;
    release_title: string;
    indexer: string | null;
    grabbed_at: string;
    completed_at: string | null;
    failed: boolean;
    fail_reason: string | null;
    post_process_error?: string | null;
    media_id: number | null;
    media_title: string | null;
    media_type: "movie" | "show" | null;
  };
}) {
  const { t } = useTranslation("common");

  const statusEl = item.failed ? (
    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-rose-300 bg-rose-900/30 rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap">
      <XCircle size={9} />
      {t("library.download.failed")}
    </span>
  ) : item.completed_at ? (
    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-900/30 rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap">
      <CheckCircle2 size={9} />
      {t("library.download.done")}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-sky-300 bg-sky-900/30 rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap">
      <Clock size={9} />
      {t("library.download.active")}
    </span>
  );

  return (
    <div className="px-4 py-3 flex items-start gap-3 hover:bg-neutral-800/40 transition-colors">
      <div className="min-w-0 flex-1 space-y-0.5">
        {item.media_title && (
          <div className="flex items-center gap-1.5">
            {item.media_type === "movie" ? (
              <Film size={10} className="text-neutral-400 shrink-0" />
            ) : (
              <Tv size={10} className="text-neutral-400 shrink-0" />
            )}
            {item.media_id ? (
              <Link
                to="/library/$libraryId"
                params={{ libraryId: String(item.media_id) }}
                className="text-[11px] font-semibold text-neutral-200 hover:text-primary-400 transition-colors truncate"
              >
                {item.media_title}
              </Link>
            ) : (
              <span className="text-[11px] font-semibold text-neutral-200 truncate">
                {item.media_title}
              </span>
            )}
          </div>
        )}
        <p
          className="text-[11px] text-neutral-400 truncate font-mono"
          title={item.release_title}
        >
          {item.release_title}
        </p>
        {(item.fail_reason || item.post_process_error) && (
          <p className="text-[10px] text-rose-400 truncate">
            {item.fail_reason ?? item.post_process_error}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        {statusEl}
        <div className="flex items-center gap-2 text-[10px] text-neutral-500">
          {item.indexer && <span>{item.indexer}</span>}
          <span className="font-mono">
            {formatRelativeShort(item.grabbed_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
