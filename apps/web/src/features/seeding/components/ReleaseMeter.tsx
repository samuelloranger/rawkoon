import { useTranslation } from "react-i18next";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { formatSeedDuration } from "@/features/seeding/lib/seedFormat";
import { cn } from "@/lib/utils";

/** Progress toward the ratio target — the only release target — plus when it lands. */
export function ReleaseMeter({
  torrent,
  className,
}: {
  torrent: SeedingTorrent;
  className?: string;
}) {
  const { t } = useTranslation("common");
  const pct = torrent.ratio_pct;
  const target = torrent.rule.ratio;
  return (
    <div className={cn("grid gap-1", className)}>
      {pct != null && target != null && (
        <div className="flex items-center gap-2.5 text-xs tabular-nums text-neutral-300">
          <span
            role="progressbar"
            aria-label={t("seeding.meter.ratio")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct * 100)}
            className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-950 ring-1 ring-inset ring-neutral-700"
          >
            <span
              className={cn(
                "block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none",
                torrent.target_met
                  ? "bg-emerald-400/80"
                  : "bg-gradient-to-r from-primary-600 to-primary-400",
              )}
              style={{ width: `${pct * 100}%` }}
            />
          </span>
          <span className="shrink-0">
            {`${(torrent.ratio ?? 0).toFixed(2)} / ${target.toFixed(1)}`}
          </span>
        </div>
      )}
      {torrent.target_met ? (
        <p className="text-[11px] text-emerald-200">{t("seeding.eta.met")}</p>
      ) : torrent.eta_secs == null ? (
        <p className="text-[11px] text-neutral-500">{t("seeding.eta.idle")}</p>
      ) : (
        <p className="text-[11px] text-neutral-500">
          {t("seeding.eta.ratio", {
            time: formatSeedDuration(torrent.eta_secs, t),
          })}
        </p>
      )}
    </div>
  );
}
