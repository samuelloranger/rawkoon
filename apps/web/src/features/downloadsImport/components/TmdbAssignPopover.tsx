import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTmdbMediaSearch } from "@/features/medias/hooks/useTmdbMediaSearch";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";
import type { DownloadListRow } from "@/features/downloadsImport/hooks/useDownloadsImport";

/**
 * Heavy panel: i18n + debounced search + TMDB query.
 * Only mounted when the popover is actually open (Radix lazy-mounts
 * `PopoverContent` children), so 500 closed rows don't subscribe to 500
 * query observers and 500 i18n contexts.
 */
function TmdbSearchPanel({
  row,
  onPick,
}: {
  row: DownloadListRow;
  onPick: (item: TmdbMediaSearchItem) => void;
}) {
  const { i18n, t } = useTranslation("common");
  const [input, setInput] = useState(() => {
    let s = `${row.parsed.title ?? ""}`.trim();
    if (row.parsed.year) s += ` ${row.parsed.year}`;
    return s.trim();
  });
  const [debounced, setDebounced] = useState(input);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(input.trim()), 280);
    return () => window.clearTimeout(t);
  }, [input]);

  const enabled = debounced.length >= 2;
  const q = useTmdbMediaSearch(debounced, {
    enabled,
    language: i18n.language,
    kind: row.parsed.kind,
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);

  return (
    <div className="space-y-2">
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={t("downloadsImport.search.placeholder")}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm"
      />
      <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
        {enabled && q.isLoading && (
          <div className="flex justify-center py-4 text-neutral-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
        {enabled &&
          !q.isLoading &&
          items.map((item) => (
            <button
              key={`${item.media_type}-${item.tmdb_id}`}
              type="button"
              onClick={() => onPick(item)}
              className="flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-white/10"
            >
              {item.poster_url ? (
                <img
                  src={item.poster_url}
                  alt=""
                  className="mt-0.5 h-12 w-8 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="mt-0.5 flex h-12 w-8 shrink-0 items-center justify-center rounded text-[10px] text-neutral-500 bg-white/10">
                  —
                </div>
              )}
              <span className="min-w-0">
                <span className="block text-sm font-medium text-neutral-50">
                  {item.title}{" "}
                  <span className="font-normal text-neutral-400">
                    {item.release_year ? `(${item.release_year})` : ""} ·{" "}
                    <span className="uppercase text-[11px]">
                      {item.media_type}
                    </span>
                  </span>
                </span>
                {item.overview ? (
                  <span className="mt-1 line-clamp-2 block text-[12px] text-neutral-400">
                    {item.overview}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        {enabled && !q.isLoading && items.length === 0 && (
          <p className="py-6 text-center text-xs text-neutral-500">
            {t("downloadsImport.search.noResults")}
          </p>
        )}
        {!enabled && (
          <p className="py-6 text-center text-xs text-neutral-500">
            {t("downloadsImport.search.typeMore")}
          </p>
        )}
      </div>
    </div>
  );
}

export function TmdbAssignPopover({
  row,
  open,
  onOpenChange,
  onPick,
}: {
  row: DownloadListRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (item: TmdbMediaSearchItem) => void;
}) {
  const { t } = useTranslation("common");
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("downloadsImport.search.trigger")}
          disabled={row.is_imported}
          className={cn(
            "rounded-lg p-1.5 hover:bg-white/10",
            row.is_imported &&
              "pointer-events-none cursor-not-allowed opacity-35",
          )}
        >
          <Search size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(26rem,calc(100vw-3rem))] p-3"
      >
        <TmdbSearchPanel row={row} onPick={onPick} />
      </PopoverContent>
    </Popover>
  );
}
