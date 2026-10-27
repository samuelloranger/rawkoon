import { useTranslation } from "react-i18next";
import {
  ArrowUpCircle,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import type { LibraryMedia } from "@rawkoon/shared/types";
import { formatEtaSeconds } from "@rawkoon/shared/utils";
import { cn } from "@/lib/utils";
import { libraryStatusPresentation } from "@/utils/libraryStatusPresentation";
import { headerActionKind } from "@/features/medias/lib/itemPageActions";
import {
  useDownloadEta,
  useDownloadProgress,
} from "@/features/medias/hooks/useActiveDownloads";
import { useLiveSearchToast } from "@/features/medias/hooks/useLiveSearchToast";
import { useRetrySkippedMedia } from "@/features/medias/hooks/useRetrySkippedMedia";
import { useSearchLibraryMovie } from "@/features/medias/hooks/useSearchLibraryMovie";

const PRIMARY =
  "bg-primary-600 text-neutral-950 hover:bg-primary-500 disabled:opacity-50";
const SECONDARY = "bg-white/10 text-neutral-100 hover:bg-white/15";
const BUTTON =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-50";

type Props = {
  item: LibraryMedia;
  isAdmin: boolean;
  onChooseRelease: () => void;
  onUpgradeSearch: () => void;
};

/** The header's admin actions for the item's current status; renders nothing for anyone else. */
export function LibraryItemActions({
  item,
  isAdmin,
  onChooseRelease,
  onUpgradeSearch,
}: Props) {
  const { t } = useTranslation("common");
  const kind = headerActionKind(item.status, isAdmin, item.airing_state);
  if (kind === "missing")
    return <MissingActions item={item} onChooseRelease={onChooseRelease} />;
  if (kind === "downloading") return <DownloadProgress item={item} />;
  if (kind === "downloaded")
    return (
      <button
        type="button"
        onClick={onUpgradeSearch}
        className={cn(BUTTON, SECONDARY)}
      >
        <ArrowUpCircle size={14} />
        {t("library.itemActions.searchUpgrade")}
      </button>
    );
  if (kind === "skipped") return <RetrySearch item={item} />;
  return null;
}

function RetrySearch({ item }: { item: LibraryMedia }) {
  const { t } = useTranslation("common");
  const retry = useRetrySkippedMedia();
  return (
    <button
      type="button"
      title={t("library.management.retrySearchTitle")}
      disabled={retry.isPending}
      onClick={() => {
        void retry
          .mutateAsync({ mediaId: item.id })
          .then(() => toast.success(t("library.management.retrySearchQueued")))
          .catch(() => toast.error(t("library.itemActions.searchAgainFailed")));
      }}
      className={cn(BUTTON, PRIMARY)}
    >
      {retry.isPending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <RefreshCw size={14} />
      )}
      {t("library.itemActions.searchAgain")}
    </button>
  );
}

function MissingActions({
  item,
  onChooseRelease,
}: {
  item: LibraryMedia;
  onChooseRelease: () => void;
}) {
  const { t } = useTranslation("common");
  const searchMovie = useSearchLibraryMovie();
  const liveSearchToast = useLiveSearchToast();

  return (
    <>
      {item.type === "movie" && (
        <button
          type="button"
          disabled={searchMovie.isPending}
          onClick={() =>
            liveSearchToast.announceSearch(
              {
                mediaId: item.id,
                title: item.title,
                profileName: item.quality_profile?.name ?? null,
                isShow: false,
              },
              () => searchMovie.mutateAsync({ id: item.id }),
            )
          }
          className={cn(BUTTON, PRIMARY)}
        >
          {searchMovie.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          {t("library.management.searchNow")}
        </button>
      )}
      <button
        type="button"
        onClick={onChooseRelease}
        className={cn(BUTTON, SECONDARY)}
      >
        <ListChecks size={14} />
        {t("library.itemActions.chooseRelease")}
      </button>
    </>
  );
}

function DownloadProgress({ item }: { item: LibraryMedia }) {
  const { t } = useTranslation("common");
  const progress = useDownloadProgress(item.id, true);
  const eta = formatEtaSeconds(useDownloadEta(item.id, true));
  const label = !progress
    ? t(libraryStatusPresentation(item.status).labelKey)
    : progress.count > 1
      ? t("library.itemActions.downloadingEpisodes", { count: progress.count })
      : t("library.itemActions.downloadingPercent", {
          percent: progress.percent,
        });

  return (
    <div className="w-full max-w-xs space-y-1">
      {/* Only the state is announced, not every percent tick. */}
      <span role="status" className="sr-only">
        {t(libraryStatusPresentation(item.status).labelKey)}
      </span>
      <p className="flex items-center gap-1.5 text-xs font-medium text-primary-200">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        {label}
        {eta && (
          <span className="font-normal text-white/60">
            · {t("library.itemActions.eta", { eta })}
          </span>
        )}
      </p>
      {progress && progress.count === 1 && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          className="h-1 overflow-hidden rounded-full bg-white/15"
        >
          <div
            className="h-full rounded-full bg-primary-500 transition-[width] duration-500"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
