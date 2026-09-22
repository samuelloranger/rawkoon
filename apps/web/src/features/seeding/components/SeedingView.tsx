import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sprout } from "lucide-react";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { useSeeding } from "@/features/seeding/hooks/useSeeding";
import { formatSeedDuration } from "@/features/seeding/lib/seedFormat";
import { formatBytes } from "@/lib/utils/format";
import { SeedingRow } from "./SeedingRow";

export type SeedingFilter = "all" | "owed" | "removed" | "idle";
const FILTERS: SeedingFilter[] = ["all", "owed", "removed", "idle"];

export function filterSeeding(
  list: SeedingTorrent[],
  f: SeedingFilter,
): SeedingTorrent[] {
  switch (f) {
    case "owed":
      return list.filter((s) => s.owes_seed_time);
    case "removed":
      return list.filter((s) => s.badges.includes("removed_from_library"));
    case "idle":
      return list.filter((s) => s.up_speed === 0);
    default:
      return list;
  }
}

export function SeedingView() {
  const { t } = useTranslation("common");
  const { data, isLoading, error } = useSeeding();
  const [filter, setFilter] = useState<SeedingFilter>("all");

  if (isLoading) return <LoadingState />;
  if (error || !data)
    return <p className="text-sm text-amber-200">{t("seeding.unreachable")}</p>;

  const total = data.torrents.reduce((sum, s) => sum + s.size_bytes, 0);
  const owed = data.torrents.filter((s) => s.owes_seed_time).length;
  const next = data.torrents.find((s) => s.eta_secs != null)?.eta_secs ?? null;
  const visible = filterSeeding(data.torrents, filter);
  const freed = data.released_today.reduce(
    (sum, r) => sum + (r.size_bytes ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      {!data.enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-neutral-100">
              {t("seeding.disabled.title")}
            </p>
            <p className="text-xs text-neutral-400">
              {t("seeding.disabled.description")}
            </p>
          </div>
          <a
            href="/settings?tab=media"
            className="text-sm text-primary-400 underline underline-offset-2"
          >
            {t("seeding.disabled.action")}
          </a>
        </div>
      )}
      {data.torrents.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[68ch] text-[15px] text-neutral-100">
            {t("seeding.summary", {
              count: data.torrents.length,
              size: formatBytes(total),
            })}{" "}
            {owed > 0 && t("seeding.summaryOwed", { count: owed })}{" "}
            {next != null &&
              t("seeding.summaryNext", { time: formatSeedDuration(next, t) })}
          </p>
          <span
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500"
            aria-live="polite"
          >
            <span
              className="size-1.5 rounded-full bg-emerald-300 motion-safe:animate-pulse"
              aria-hidden
            />
            {t("seeding.live")}
          </span>
        </div>
      )}
      <SegmentedTabs
        variant="chips"
        items={FILTERS.map((f) => ({
          id: f,
          label: t(`seeding.filters.${f}`),
        }))}
        value={filter}
        onChange={setFilter}
        ariaLabel={t("seeding.filters.all")}
      />
      {data.torrents.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title={t("seeding.empty.title")}
          description={t("seeding.empty.description")}
        />
      ) : (
        <ul className="divide-y divide-neutral-700 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
          {visible.map((s) => (
            <SeedingRow key={s.hash} torrent={s} />
          ))}
        </ul>
      )}
      {data.released_today.length > 0 && (
        <details
          open
          className="rounded-xl border border-dashed border-neutral-600 px-4 py-2.5 text-sm text-neutral-400"
        >
          <summary className="flex cursor-pointer list-none justify-between gap-3">
            <span className="font-semibold text-neutral-200">
              {t("seeding.releasedToday", {
                count: data.released_today.length,
              })}
            </span>
            <span>{t("seeding.freed", { size: formatBytes(freed) })}</span>
          </summary>
          <ul className="mt-2.5 grid gap-1.5">
            {data.released_today.map((r) => (
              <li
                key={r.hash}
                className="flex justify-between gap-3 text-xs motion-safe:animate-in motion-safe:fade-in"
              >
                <span>{r.title}</span>
                <span className="text-neutral-500">
                  {t(`seeding.releasedReason.${r.reason}`, {
                    defaultValue: r.reason,
                  })}
                  {r.size_bytes != null && (
                    <span className="ml-3 inline-block min-w-16 text-right">
                      {formatBytes(r.size_bytes)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
