import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAddToLibrary } from "@/features/medias/hooks/useAddToLibrary";
import { useAddToWatchlist } from "@/features/medias/hooks/useAddToWatchlist";
import { useMediaModalData } from "@/features/medias/hooks/useMediaModalData";
import { useRemoveFromWatchlist } from "@/features/medias/hooks/useRemoveFromWatchlist";
import { type TmdbMediaSearchItem } from "@rawkoon/shared/types";
import { Info, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/dialog";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { SimilarMediasPanel } from "@/pages/medias/_component/SimilarMediasPanel";
import { ExploreCardHero } from "./ExploreCardHero";
import { ExploreCardActions } from "./ExploreCardActions";
import { ExploreCardInfoTab } from "./ExploreCardInfoTab";

type TabKey = "info" | "similar";

interface ExploreCardDetailDialogProps {
  item: TmdbMediaSearchItem;
  isOpen: boolean;
  onClose: () => void;
  onAdded?: () => void;
}

export function ExploreCardDetailDialog({
  item,
  isOpen,
  onClose,
  onAdded,
}: ExploreCardDetailDialogProps) {
  const { t, i18n } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<TabKey>("info");
  const [imageError, setImageError] = useState(false);

  const addMutation = useAddToLibrary();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const itemKey = `${item.tmdb_id}:${item.media_type}`;

  const { data: modalData, isPending: modalDataPending } = useMediaModalData(
    item.media_type,
    item.tmdb_id,
    { enabled: isOpen },
    i18n.language,
  );

  const [loadedBackdropUrl, setLoadedBackdropUrl] = useState<string | null>(
    null,
  );
  const [loadedPosterKey, setLoadedPosterKey] = useState<string | null>(null);

  const isInWatchlist = modalData?.watchlist_status ?? false;
  const providers = modalData?.providers ?? null;
  const trailerData = modalData?.trailer ?? null;
  const ratingsData = modalData?.ratings ?? null;
  const creditsData = modalData?.credits ?? null;
  const detailsData = modalData?.details ?? null;
  const libraryEpisodes = modalData?.library_episodes ?? null;

  const episodesBySeason = useMemo(() => {
    const m = new Map<number, { episode_number: number }[]>();
    for (const e of libraryEpisodes?.downloaded ?? []) {
      const arr = m.get(e.season_number) ?? [];
      arr.push({ episode_number: e.episode_number });
      m.set(e.season_number, arr);
    }
    return m;
  }, [libraryEpisodes?.downloaded]);

  const hasTmdbId = item.tmdb_id > 0;

  const tabs = useMemo(() => {
    const result: { key: TabKey; label: string; icon: typeof Info }[] = [
      { key: "info", label: t("medias.detail.tabInfo", "Info"), icon: Info },
    ];
    if (hasTmdbId)
      result.push({
        key: "similar",
        label: t("medias.detail.tabSimilar", "Similar"),
        icon: Sparkles,
      });
    return result;
  }, [hasTmdbId, t]);

  const validTab = tabs.some((tab) => tab.key === activeTab)
    ? activeTab
    : "info";

  const handleAdd = async () => {
    if (addMutation.isPending || !item.can_add) return;
    try {
      await addMutation.mutateAsync({
        tmdb_id: item.tmdb_id,
        type: item.media_type === "tv" ? "show" : "movie",
      });
      toast.success(t("medias.addSuccess", { title: item.title }));
      onAdded?.();
    } catch {
      toast.error(t("medias.addFailed"));
    }
  };

  const handleWatchlistToggle = async () => {
    if (isInWatchlist) {
      await removeFromWatchlist.mutateAsync({
        tmdb_id: item.tmdb_id,
        media_type: item.media_type,
      });
    } else {
      await addToWatchlist.mutateAsync({
        tmdb_id: item.tmdb_id,
        media_type: item.media_type,
        title: item.title,
        poster_url: item.poster_url,
        overview: item.overview,
        release_year: item.release_year,
        vote_average: item.vote_average,
        release_date:
          item.media_type === "movie"
            ? (detailsData?.release_date ?? null)
            : null,
      });
    }
  };

  const tmdbUrl = `https://www.themoviedb.org/${item.media_type}/${item.tmdb_id}`;

  const overview = item.overview ?? detailsData?.overview ?? null;
  const voteAverage = item.vote_average ?? detailsData?.vote_average ?? null;
  const runtime = detailsData?.runtime ?? null;
  const collection = detailsData?.belongs_to_collection ?? null;

  const runtimeStr = runtime
    ? `${Math.floor(runtime / 60)}h${runtime % 60 > 0 ? ` ${runtime % 60}m` : ""}`
    : null;

  /** First backdrop: primary TMDB image, else first still in "Visuels" — used as hero background */
  const heroBackdropUrl =
    detailsData?.primary_backdrop_url ??
    detailsData?.media_stills?.backdrops?.[0]?.url ??
    null;

  // Derived: reset automatically when the URL or item key changes — no effect needed.
  const heroBackdropLoaded = loadedBackdropUrl === heroBackdropUrl;
  const posterLoaded = isOpen && loadedPosterKey === itemKey;
  const heroVisualReady = !heroBackdropUrl || heroBackdropLoaded;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={item.title}
      hideTitle
      bodyScroll
      panelClassName="max-w-3xl p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <ExploreCardHero
          item={item}
          detailsData={detailsData}
          ratingsData={ratingsData}
          creditsData={creditsData}
          heroBackdropUrl={heroBackdropUrl}
          heroBackdropLoaded={heroBackdropLoaded}
          heroVisualReady={heroVisualReady}
          posterLoaded={posterLoaded}
          imageError={imageError}
          runtimeStr={runtimeStr}
          collection={collection}
          voteAverage={voteAverage}
          onBackdropLoaded={setLoadedBackdropUrl}
          onPosterLoaded={() => setLoadedPosterKey(itemKey)}
          onImageError={() => setImageError(true)}
        />

        {/* ── Scrollable body (actions, tabs, panels) ───────────────── */}
        <div className="ios-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-4">
          {modalDataPending && !modalData ? (
            <div
              className="flex flex-col items-center justify-center gap-3 py-16"
              aria-busy="true"
              aria-label={t("common.loading")}
            >
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-neutral-600 border-t-primary-400" />
            </div>
          ) : (
            <div
              className="animate-in fade-in slide-in-from-bottom-3 duration-500 ease-out motion-reduce:animate-none"
              key={
                modalData ? `detail-${item.tmdb_id}` : `item-${item.tmdb_id}`
              }
            >
              {/* ── Actions bar (above tabs) ──────────────────────────────── */}
              <ExploreCardActions
                item={item}
                isInWatchlist={isInWatchlist}
                isAddPending={addMutation.isPending}
                isWatchlistPending={
                  addToWatchlist.isPending || removeFromWatchlist.isPending
                }
                trailerData={trailerData}
                tmdbUrl={tmdbUrl}
                onAdd={handleAdd}
                onWatchlistToggle={handleWatchlistToggle}
                onClose={onClose}
              />

              {/* ── Tab pills ─────────────────────────────────────────────── */}
              {tabs.length > 1 && (
                <SegmentedTabs
                  items={tabs.map((tab) => ({
                    id: tab.key,
                    label: tab.label,
                    icon: tab.icon,
                  }))}
                  value={validTab}
                  onChange={setActiveTab}
                  containerClassName="mb-4"
                />
              )}

              {/* ── Info tab ─────────────────────────────────────────────── */}
              {validTab === "info" && (
                <ExploreCardInfoTab
                  mediaType={item.media_type}
                  tmdbId={item.tmdb_id}
                  displayTitle={item.title}
                  overview={overview}
                  trailerData={trailerData}
                  creditsData={creditsData}
                  providers={providers}
                  detailsData={detailsData}
                  libraryEpisodes={libraryEpisodes}
                  episodesBySeason={episodesBySeason}
                />
              )}

              {/* ── Similar tab ──────────────────────────────────────────── */}
              {validTab === "similar" && (
                <div className="min-h-[300px] pb-6 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
                  <SimilarMediasPanel
                    isActive={isOpen && validTab === "similar"}
                    tmdbId={item.tmdb_id}
                    mediaType={item.media_type}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
