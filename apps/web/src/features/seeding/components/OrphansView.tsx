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

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-neutral-400">
        {t("orphans.explain")}
      </p>
      <div className="overflow-x-auto rounded-xl border border-neutral-700 bg-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-neutral-500">
            <tr className="border-b border-neutral-700">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={t("orphans.selectAll")}
                  className="accent-primary-500"
                  checked={chosen.length === orphans.length}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(orphans.map((o) => o.hash))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th className="px-3 py-2.5 font-medium">
                {t("orphans.columns.torrent")}
              </th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">
                {t("orphans.columns.category")}
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                {t("orphans.columns.size")}
              </th>
              <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">
                {t("orphans.columns.ratio")}
              </th>
              <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">
                {t("orphans.columns.seeding")}
              </th>
            </tr>
          </thead>
          <tbody>
            {orphans.map((o) => (
              <tr
                key={o.hash}
                className={cn(
                  "border-b border-neutral-700 last:border-0",
                  selected.has(o.hash) && "bg-primary-400/5",
                )}
              >
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={t("orphans.select", { name: o.name })}
                    className="accent-primary-500"
                    checked={selected.has(o.hash)}
                    onChange={() => toggle(o.hash)}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <span className="break-all font-mono text-xs text-neutral-200">
                    {o.name}
                  </span>
                  {o.shares_data && (
                    <span className="mt-1 block w-fit rounded-full border border-neutral-600 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-neutral-400">
                      {t("orphans.shares")}
                    </span>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 text-neutral-400 md:table-cell">
                  {o.category}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatBytes(o.size_bytes)}
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
                  {o.ratio?.toFixed(2) ?? "—"}
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
                  {o.seeding_time_secs != null
                    ? formatSeedDuration(o.seeding_time_secs, t)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chosen.length > 0 && (
        <div
          role="region"
          aria-label={t("orphans.selected", {
            count: chosen.length,
            size: formatBytes(bytes),
          })}
          className="fixed bottom-5 left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center gap-3.5 rounded-2xl border border-neutral-600 bg-neutral-800 py-2.5 pl-4 pr-3 shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-4"
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
              className="accent-primary-500"
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
          >
            {t("orphans.remove", { count: chosen.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
