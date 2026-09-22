import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { useReleaseTorrent } from "@/features/seeding/hooks/useSeeding";
import { formatBytes } from "@/lib/utils/format";
import { ReleaseMeter } from "./ReleaseMeter";

const BADGE =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold";

export function SeedingRow({ torrent }: { torrent: SeedingTorrent }) {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const release = useReleaseTorrent();
  const idleRatioOnly =
    torrent.up_speed === 0 &&
    torrent.rule.seed_time_mins == null &&
    !torrent.target_met;

  const onRemove = () =>
    confirm({
      variant: "destructive",
      title: t("seeding.confirmTitle", { title: torrent.title }),
      description: (
        <div className="space-y-2">
          <p>{t("seeding.confirmBody")}</p>
          {torrent.owes_seed_time && (
            <p className="rounded-lg border border-amber-900/70 bg-amber-950/40 px-3 py-2 text-amber-200">
              {t("seeding.confirmHnr", { indexer: torrent.indexer ?? "" })}
            </p>
          )}
        </div>
      ),
      confirmLabel: t("seeding.confirmLabel"),
      onConfirm: async () => {
        try {
          await release.mutateAsync(torrent.hash);
          toast.success(t("seeding.removed", { title: torrent.title }));
        } catch {
          toast.error(t("seeding.removeError"));
        }
      },
    });

  return (
    <li className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-3.5 md:grid-cols-[44px_minmax(0,1fr)_minmax(250px,320px)_auto] md:items-center">
      {torrent.poster_url ? (
        <img
          src={torrent.poster_url}
          alt=""
          loading="lazy"
          className="h-16 w-11 rounded object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="grid h-16 w-11 place-items-center rounded bg-neutral-700 font-display text-lg text-neutral-400"
        >
          {torrent.title.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate font-semibold text-neutral-50">
          {torrent.title}{" "}
          <span className="font-normal text-neutral-500">
            {torrent.kind_label === "ebook" ||
            torrent.kind_label === "audiobook"
              ? t(`seeding.kind.${torrent.kind_label}`)
              : torrent.year}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-neutral-400">
          <span className="inline-flex items-center gap-1">
            {torrent.is_private && <Lock size={12} aria-label="private" />}
            {torrent.indexer}
          </span>
          <span>{formatBytes(torrent.size_bytes)}</span>
          <span>
            {torrent.up_speed > 0
              ? `↑ ${formatBytes(torrent.up_speed)}/s`
              : t("seeding.filters.idle")}
          </span>
          {torrent.badges.map((b) => (
            <span
              key={b}
              className={`${BADGE} border-neutral-700 bg-white/5 text-neutral-400`}
            >
              {t(`seeding.badges.${b}`)}
            </span>
          ))}
          {torrent.owes_seed_time && (
            <span
              className={`${BADGE} border-amber-900/70 bg-amber-950/40 text-amber-200`}
            >
              {t("seeding.badges.owes")}
            </span>
          )}
        </div>
        {idleRatioOnly && (
          <p className="mt-1.5 max-w-[52ch] text-xs text-amber-200">
            {t("seeding.idleHint")}{" "}
            <a
              href="/settings?tab=media"
              className="text-primary-400 underline underline-offset-2"
            >
              {t("seeding.idleHintLink")}
            </a>
          </p>
        )}
      </div>
      <ReleaseMeter torrent={torrent} className="col-span-2 md:col-span-1" />
      <div className="col-span-2 md:col-span-1 md:text-right">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={release.isPending}
          onClick={onRemove}
          className="whitespace-nowrap"
        >
          {t("seeding.removeNow")}
        </Button>
      </div>
    </li>
  );
}
