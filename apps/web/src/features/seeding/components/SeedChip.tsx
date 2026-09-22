import { useTranslation } from "react-i18next";
import type { DownloadSeedState } from "@rawkoon/shared/types";
import { formatSeedDuration } from "@/features/seeding/lib/seedFormat";
import { cn } from "@/lib/utils";

const TONE: Record<DownloadSeedState["state"], string> = {
  seeding: "border-emerald-900/60 bg-emerald-950/40 text-emerald-200",
  released: "border-neutral-700 bg-white/5 text-neutral-400",
  blocklisted: "border-amber-900/70 bg-amber-950/40 text-amber-200",
};

export function SeedChip({
  seed,
}: {
  seed: DownloadSeedState | null | undefined;
}) {
  const { t } = useTranslation("common");
  if (!seed) return null;
  const tone =
    seed.state === "blocklisted" && seed.reason === "malware"
      ? "border-red-900 bg-red-950/40 text-red-300"
      : TONE[seed.state];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
      <span
        className={cn("rounded-full border px-2 py-0.5 font-semibold", tone)}
      >
        {t(`library.download.seed.${seed.state}`)}
      </span>
      {seed.state === "seeding" ? (
        <span>
          {t("library.download.seed.seedingDetail", {
            ratio: (seed.ratio ?? 0).toFixed(2),
            time: formatSeedDuration(seed.seeding_time_secs ?? 0, t),
          })}
        </span>
      ) : seed.reason ? (
        <span>{t(`library.download.seed.reason.${seed.reason}`)}</span>
      ) : null}
    </span>
  );
}
