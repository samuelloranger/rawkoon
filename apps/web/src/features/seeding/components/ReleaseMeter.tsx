import { useTranslation } from "react-i18next";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import {
  formatSeedDuration,
  meterTimeLabel,
} from "@/features/seeding/lib/seedFormat";

function MeterBar({
  label,
  pct,
  lead,
  value,
  noTarget,
}: {
  label: string;
  pct: number | null;
  lead: boolean;
  value: string | null;
  noTarget: string;
}) {
  if (pct == null || value == null) {
    return (
      <div className="grid grid-cols-[52px_1fr_auto] items-center gap-2 text-xs text-neutral-500">
        <span>{label}</span>
        <span
          className="h-px border-t border-dashed border-neutral-700"
          aria-hidden
        />
        <span>{noTarget}</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "grid grid-cols-[52px_1fr_auto] items-center gap-2 text-xs tabular-nums",
        lead ? "text-neutral-100" : "text-neutral-500",
      )}
    >
      <span>{label}</span>
      <span
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        className="block h-1.5 overflow-hidden rounded-full bg-neutral-950 ring-1 ring-inset ring-neutral-700"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none",
            lead
              ? "bg-gradient-to-r from-primary-600 to-primary-400"
              : "bg-neutral-600",
          )}
          style={{ width: `${pct * 100}%` }}
        />
      </span>
      <span>{value}</span>
    </div>
  );
}

export function ReleaseMeter({
  torrent,
  className,
}: {
  torrent: SeedingTorrent;
  className?: string;
}) {
  const { t } = useTranslation("common");
  const noTarget = t("seeding.meter.noTarget");
  const eta = torrent.target_met ? (
    <p className="text-xs text-emerald-200">{t("seeding.eta.met")}</p>
  ) : torrent.eta_secs == null ? (
    <p className="text-xs text-neutral-400">{t("seeding.eta.idle")}</p>
  ) : (
    <p className="text-xs text-neutral-400">
      {t(torrent.lead === "time" ? "seeding.eta.time" : "seeding.eta.ratio", {
        time: formatSeedDuration(torrent.eta_secs, t),
      })}
    </p>
  );
  return (
    <div className={cn("grid gap-1.5", className)}>
      <MeterBar
        label={t("seeding.meter.ratio")}
        pct={torrent.ratio_pct}
        lead={torrent.lead === "ratio"}
        value={
          torrent.rule.ratio != null
            ? `${(torrent.ratio ?? 0).toFixed(2)} / ${torrent.rule.ratio.toFixed(1)}`
            : null
        }
        noTarget={noTarget}
      />
      <MeterBar
        label={t("seeding.meter.time")}
        pct={torrent.time_pct}
        lead={torrent.lead === "time"}
        value={
          torrent.rule.seed_time_mins != null
            ? meterTimeLabel(
                torrent.seeding_time_secs ?? 0,
                torrent.rule.seed_time_mins,
                t,
              )
            : null
        }
        noTarget={noTarget}
      />
      {eta}
    </div>
  );
}
