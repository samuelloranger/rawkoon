import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ghost } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/button";
import {
  useOrphans,
  useRemoveOrphans,
} from "@/features/seeding/hooks/useOrphans";
import { formatSeedDuration } from "@/features/seeding/lib/seedFormat";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils/format";

export function OrphansView() {
  const { t } = useTranslation("common");
  const { data, isLoading, error } = useOrphans();
  const remove = useRemoveOrphans();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteData, setDeleteData] = useState(true);

  if (isLoading) return <LoadingState />;
  if (error || !data)
    return <p className="text-sm text-amber-200">{t("seeding.unreachable")}</p>;

  const orphans = data.orphans;
  const chosen = orphans.filter((o) => selected.has(o.hash));
  const bytes = chosen.reduce((sum, o) => sum + o.size_bytes, 0);
  const toggle = (hash: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });

  const onRemove = async () => {
    try {
      const res = await remove.mutateAsync({
        hashes: chosen.map((o) => o.hash),
        delete_data: deleteData,
      });
      const msg = t("orphans.removed", { count: res.removed.length });
      toast.success(
        res.freed_bytes > 0
          ? `${msg} ${t("orphans.freed", { size: formatBytes(res.freed_bytes) })}`
          : msg,
      );
      setSelected(new Set());
    } catch {
      toast.error(t("orphans.removeError"));
    }
  };

  if (orphans.length === 0) {
    return (
      <EmptyState
        icon={Ghost}
        title={t("orphans.empty.title")}
        description={t("orphans.empty.description")}
      />
    );
  }

  const allSelected = chosen.length === orphans.length;
  return (
    <div className="space-y-3 pb-24">
      <p className="max-w-[70ch] text-sm text-neutral-400">
        {t("orphans.explain")}
      </p>
      <div className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
        <div className="flex items-center gap-3 border-b border-neutral-700 px-3 py-2.5 text-xs text-neutral-500">
          <input
            type="checkbox"
            aria-label={t("orphans.selectAll")}
            className="size-4 accent-primary-500"
            checked={allSelected}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? new Set(orphans.map((o) => o.hash))
                  : new Set(),
              )
            }
          />
          <span className="flex-1">{t("orphans.columns.torrent")}</span>
          <span className="hidden w-28 md:block">
            {t("orphans.columns.category")}
          </span>
          <span className="w-16 text-right">{t("orphans.columns.size")}</span>
          <span className="hidden w-14 text-right md:block">
            {t("orphans.columns.ratio")}
          </span>
          <span className="hidden w-16 text-right md:block">
            {t("orphans.columns.seeding")}
          </span>
        </div>
        <ul className="divide-y divide-neutral-700">
          {orphans.map((o) => (
            <li
              key={o.hash}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5 md:items-center",
                selected.has(o.hash) && "bg-primary-400/5",
              )}
            >
              <input
                type="checkbox"
                aria-label={t("orphans.select", { name: o.name })}
                className="mt-0.5 size-4 shrink-0 accent-primary-500 md:mt-0"
                checked={selected.has(o.hash)}
                onChange={() => toggle(o.hash)}
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm text-neutral-200 [overflow-wrap:anywhere]">
                  {o.name}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-neutral-500 md:hidden">
                  <span>{o.category}</span>
                  <span>
                    {t("orphans.columns.ratio")} {o.ratio?.toFixed(2) ?? "—"}
                  </span>
                  {o.seeding_time_secs != null && (
                    <span>{formatSeedDuration(o.seeding_time_secs, t)}</span>
                  )}
                </p>
                {o.shares_data && (
                  <span className="mt-1 inline-block rounded-full border border-neutral-600 bg-white/5 px-2 py-px text-[10px] font-semibold text-neutral-400">
                    {t("orphans.shares")}
                  </span>
                )}
              </div>
              <span className="hidden w-28 truncate text-xs text-neutral-400 md:block">
                {o.category}
              </span>
              <span className="w-16 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-neutral-300">
                {formatBytes(o.size_bytes)}
              </span>
              <span className="hidden w-14 text-right text-xs tabular-nums md:block">
                {o.ratio?.toFixed(2) ?? "—"}
              </span>
              <span className="hidden w-16 text-right text-xs tabular-nums md:block">
                {o.seeding_time_secs != null
                  ? formatSeedDuration(o.seeding_time_secs, t)
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {chosen.length > 0 && (
        <div
          role="region"
          aria-label={t("orphans.selected", {
            count: chosen.length,
            size: formatBytes(bytes),
          })}
          style={{ bottom: "calc(var(--safe-bottom) + 12px)" }}
          className="fixed inset-x-3 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-neutral-600 bg-neutral-800 px-4 py-3 shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-4 md:inset-x-auto md:left-1/2 md:max-w-[calc(100%-32px)] md:-translate-x-1/2"
        >
          <span className="font-semibold tabular-nums text-neutral-50">
            {t("orphans.selected", {
              count: chosen.length,
              size: formatBytes(bytes),
            })}
          </span>
          <label className="flex items-center gap-2 text-sm text-neutral-400">
            <input
              type="checkbox"
              className="size-4 accent-primary-500"
              checked={deleteData}
              onChange={(e) => setDeleteData(e.target.checked)}
              aria-label={t("orphans.deleteData")}
            />
            {t("orphans.deleteData")}
          </label>
          {deleteData && chosen.some((o) => o.shares_data) && (
            <span className="rounded-full border border-amber-900/70 bg-amber-950/40 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
              {t("orphans.sharedNote")}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={remove.isPending}
            onClick={onRemove}
            className="w-full md:ml-auto md:w-auto"
          >
            {t("orphans.remove", { count: chosen.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
