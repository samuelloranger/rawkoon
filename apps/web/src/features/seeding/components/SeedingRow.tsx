import { useTranslation } from "react-i18next";
import { Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { useReleaseTorrent } from "@/features/seeding/hooks/useSeeding";
import { formatBytes } from "@/lib/utils/format";
import { ReleaseMeter } from "./ReleaseMeter";

const BADGE =
  "inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold";

export function SeedingRow({ torrent }: { torrent: SeedingTorrent }) {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const release = useReleaseTorrent();
  const idle = torrent.up_speed === 0 && !torrent.target_met;

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
    <li className="flex gap-3 px-3 py-3 sm:px-4">
      {torrent.poster_url ? (
        <img
          src={torrent.poster_url}
          alt=""
          loading="lazy"
          className="h-14 w-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="grid h-14 w-10 shrink-0 place-items-center rounded bg-neutral-700 font-display text-base text-neutral-400"
        >
          {torrent.title.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-50">
            {torrent.title}{" "}
            <span className="font-normal text-neutral-500">
              {torrent.kind_label === "ebook" ||
              torrent.kind_label === "audiobook"
                ? t(`seeding.kind.${torrent.kind_label}`)
                : torrent.year}
            </span>
          </p>
          <button
            type="button"
            aria-label={t("seeding.removeNow")}
            title={t("seeding.removeNow")}
            disabled={release.isPending}
            onClick={onRemove}
            className="focus-ring -mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-neutral-500 hover:bg-white/5 hover:text-neutral-100 disabled:opacity-50"
          >
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
          <span className="inline-flex items-center gap-1">
            {torrent.is_private && <Lock size={11} aria-label="private" />}
            {torrent.indexer}
          </span>
          <span>{formatBytes(torrent.size_bytes)}</span>
          {torrent.up_speed > 0 && (
            <span>↑ {formatBytes(torrent.up_speed)}/s</span>
          )}
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
        <ReleaseMeter torrent={torrent} className="mt-2" />
        {idle && (
          <p className="mt-1 text-[11px] text-amber-200/90">
            {t("seeding.idleHint")}
          </p>
        )}
      </div>
    </li>
  );
}
