import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Headphones, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import type { BookEdition } from "@rawkoon/shared/types";
import {
  useBookManifest,
  useBookProgress,
  useEndReading,
} from "./useBookReading";
import { OfflineButton } from "./OfflineButton";
import { usePlayer } from "@/features/player/PlayerProvider";
import { formatClock } from "@/features/player/formatClock";

/**
 * Read, Listen, or Continue — and the offline control beside it.
 *
 * "Continue" replaces the verb once there is a position, and the same word
 * appears on the books list badge, so one idea keeps one name across the app.
 */
export const EditionOpenActions = ({
  bookId,
  edition,
}: {
  bookId: number;
  edition: BookEdition;
}) => {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { openEdition } = usePlayer();
  const { confirm } = useConfirm();
  const endReading = useEndReading(edition.id);
  const hasFiles = edition.file_count > 0;
  const { data: manifestData } = useBookManifest(hasFiles ? edition.id : null);
  const { data: progressData } = useBookProgress(hasFiles ? [edition.id] : []);

  if (!hasFiles) return null;

  const manifest = manifestData?.manifest;
  const progress = progressData?.progress[0] ?? null;
  const isAudiobook = edition.kind === "audiobook";
  const started =
    (progress?.percent ?? 0) > 0.001 || (progress?.position_secs ?? 0) > 1;

  // An ebook edition holding only mobi or azw3 has nothing to open in a
  // browser; the file list below already offers the download.
  const openableFileId = isAudiobook
    ? (manifest?.files[0]?.id ?? null)
    : (manifest?.primary_file_id ?? null);
  if (manifest && openableFileId == null) return null;

  // An audiobook is every track; an ebook is the one file the reader opens.
  const offlineFileIds = isAudiobook
    ? (manifest?.files.map((file) => file.id) ?? [])
    : openableFileId != null
      ? [openableFileId]
      : [];

  const label = started
    ? t("books.open.continue")
    : isAudiobook
      ? t("books.open.listen")
      : t("books.open.read");

  const Icon = started ? Play : isAudiobook ? Headphones : BookOpen;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={() => {
          if (isAudiobook) void openEdition(edition.id);
          else
            void navigate({
              to: "/books/$bookId/read",
              params: { bookId: String(bookId) },
            });
        }}
      >
        <Icon className="mr-1.5 h-3.5 w-3.5" />
        {label}
      </Button>

      {started && (
        <span className="font-mono text-xs text-neutral-500">
          {isAudiobook && progress?.position_secs != null
            ? formatClock(progress.position_secs)
            : `${Math.round((progress?.percent ?? 0) * 100)}%`}
        </span>
      )}

      {started && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            confirm({
              variant: "destructive",
              title: t("books.open.restartTitle"),
              description: t("books.open.restartDescription"),
              confirmLabel: t("books.open.restart"),
              onConfirm: async () => {
                await endReading.mutateAsync({ mode: "reset" });
              },
            })
          }
          disabled={endReading.isPending}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t("books.open.restart")}
        </Button>
      )}

      {offlineFileIds.length > 0 && (
        <OfflineButton
          fileIds={offlineFileIds}
          bookId={bookId}
          editionId={edition.id}
        />
      )}
    </div>
  );
};
