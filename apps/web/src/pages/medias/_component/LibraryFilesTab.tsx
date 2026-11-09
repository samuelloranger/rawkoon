import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { useLibraryFiles } from "@/features/medias/hooks/useLibraryFiles";
import { useLibraryEpisodes } from "@/features/medias/hooks/useLibraryEpisodes";
import { useSearchLibraryEpisode } from "@/features/medias/hooks/useSearchLibraryEpisode";
import { useSearchSeasonPack } from "@/features/medias/hooks/useSearchSeasonPack";
import { useRetrySkippedMedia } from "@/features/medias/hooks/useRetrySkippedMedia";
import { useRetrySkippedSeason } from "@/features/medias/hooks/useRetrySkippedSeason";
import { useToggleEpisodeMonitored } from "@/features/medias/hooks/useToggleEpisodeMonitored";
import { useToggleSeasonMonitored } from "@/features/medias/hooks/useToggleSeasonMonitored";
import { useDeleteLibraryEpisode } from "@/features/medias/hooks/useDeleteLibraryEpisode";
import { useDeleteLibraryFile } from "@/features/medias/hooks/useDeleteLibraryFile";
import type { LibraryFileInfo } from "@rawkoon/shared/types";
import { Card } from "./LibrarySharedUI";
import { getMappedFolder } from "@/utils/libraryDisplayUtils";
import { LibraryShowSeason } from "./LibraryShowSeason";
import { LibraryFilesBySeason } from "./LibraryFilesBySeason";
import { LibraryMovieFileCard } from "./LibraryMovieFileCard";
import { LibraryDownloadHistory } from "./LibraryDownloadHistory";
import { ReencodeModal } from "@/features/transcode/ReencodeModal";

interface LibraryFilesTabProps {
  libraryId: number;
  onSearchEpisode?: (ep: {
    id: number;
    season: number;
    episode: number;
    title: string | null;
  }) => void;
  onSearchSeason?: (season: number) => void;
  focusSeason?: number | null;
  focusEpisode?: number | null;
}

export function LibraryFilesTab({
  libraryId,
  onSearchEpisode,
  onSearchSeason,
  focusSeason = null,
  focusEpisode = null,
}: LibraryFilesTabProps) {
  const { t } = useTranslation("common");
  const { data, isLoading } = useLibraryFiles(libraryId);
  const isAdmin = useCurrentUser().data?.is_admin === true;
  const deleteFile = useDeleteLibraryFile(libraryId);
  const deleteEpisodeMut = useDeleteLibraryEpisode(libraryId);
  const searchEpMut = useSearchLibraryEpisode();
  const searchSeasonPackMut = useSearchSeasonPack();
  const retryEpMut = useRetrySkippedMedia();
  const retrySeasonMut = useRetrySkippedSeason();
  const toggleEpMonitoredMut = useToggleEpisodeMonitored();
  const toggleSeasonMonitoredMut = useToggleSeasonMonitored();
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [reencode, setReencode] = useState<{ season: number | null } | null>(
    null,
  );
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(
    new Set(),
  );

  const files = useMemo(() => data?.files ?? [], [data?.files]);
  const isShow = data?.media_type === "show";
  const episodesQuery = useLibraryEpisodes(isShow ? libraryId : null);

  useEffect(() => {
    if (focusSeason == null) return;
    setExpandedSeasons((prev) => new Set(prev).add(focusSeason));
    if (focusEpisode == null) return;
    const id = `library-episode-${focusSeason}-${focusEpisode}`;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "nearest" });
    });
  }, [focusSeason, focusEpisode, episodesQuery.data]);

  const fileByEp = useMemo(() => {
    const m = new Map<string, LibraryFileInfo>();
    for (const f of files) {
      if (f.season != null && f.episode != null) {
        m.set(`${f.season}_${f.episode}`, f);
      }
    }
    return m;
  }, [files]);

  const hasEpisodes = isShow && episodesQuery.data != null;

  const toggleSeason = (season: number) =>
    setExpandedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(season)) {
        next.delete(season);
      } else {
        next.add(season);
      }
      return next;
    });

  if (isLoading) {
    return (
      <div className="px-5 py-10 text-center text-sm text-neutral-500">
        {t("library.media.loadingFileInfo")}
      </div>
    );
  }

  const mappedFolder = files.length ? getMappedFolder(files, isShow) : null;

  const noFiles = !files.length && !hasEpisodes && !episodesQuery.isLoading;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-sans text-base font-semibold text-neutral-100">
          {isShow ? t("library.files.seasons") : t("library.files.file")}
        </h2>
        {mappedFolder && (
          <p className="-mt-1.5 mb-3 break-all font-mono text-xs text-neutral-400">
            {mappedFolder}
          </p>
        )}

        {isShow ? (
          <Card>
            {episodesQuery.isLoading && (
              <div className="px-4 py-4 text-sm text-neutral-400">
                {t("library.media.loadingEpisodes")}
              </div>
            )}
            {noFiles && (
              <div className="px-4 py-4 text-sm text-neutral-400">
                {t("library.media.noFileMetadata")}
              </div>
            )}
            {hasEpisodes ? (
              <div className="divide-y divide-border">
                {episodesQuery.data!.seasons.map((s) => (
                  <LibraryShowSeason
                    key={s.season}
                    s={s}
                    libraryId={libraryId}
                    files={files}
                    fileByEp={fileByEp}
                    isExpanded={expandedSeasons.has(s.season)}
                    toggleSeason={toggleSeason}
                    setReencode={setReencode}
                    t={t}
                    onSearchEpisode={onSearchEpisode}
                    onSearchSeason={onSearchSeason}
                    searchEpMut={searchEpMut}
                    searchSeasonPackMut={searchSeasonPackMut}
                    retryEpMut={retryEpMut}
                    retrySeasonMut={retrySeasonMut}
                    toggleEpMonitoredMut={toggleEpMonitoredMut}
                    toggleSeasonMonitoredMut={toggleSeasonMonitoredMut}
                    deleteEpisodeMut={deleteEpisodeMut}
                  />
                ))}
              </div>
            ) : (
              /* Episodes not loaded yet but files exist — group by season */
              <LibraryFilesBySeason
                files={files}
                expandedSeasons={expandedSeasons}
                toggleSeason={toggleSeason}
                t={t}
              />
            )}
          </Card>
        ) : noFiles ? (
          <Card>
            <p className="px-4 py-4 text-sm text-neutral-400">
              {t("library.media.noFileMetadata")}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {files.map((file) => (
              <LibraryMovieFileCard
                key={file.id}
                file={file}
                confirmingDelete={deleteConfirmId === file.id}
                setConfirmingDelete={(confirming) =>
                  setDeleteConfirmId(confirming ? file.id : null)
                }
                deleteFile={deleteFile}
              />
            ))}
          </div>
        )}
      </section>

      {isAdmin && <LibraryDownloadHistory libraryId={libraryId} />}

      {reencode && (
        <ReencodeModal
          isOpen
          onClose={() => setReencode(null)}
          selection={{
            media_id: libraryId,
            ...(reencode.season != null ? { season: reencode.season } : {}),
          }}
          subtitle={
            reencode.season != null
              ? `${t("transcode.openSeason")} ${reencode.season}`
              : t("transcode.fileCount", { count: files.length })
          }
        />
      )}
    </div>
  );
}
