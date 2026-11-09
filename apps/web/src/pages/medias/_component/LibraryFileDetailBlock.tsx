import { useState } from "react";
import {
  Clock,
  Film,
  Gauge,
  HardDrive,
  Music,
  Pencil,
  Shuffle,
  Subtitles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatBytes } from "@/lib/utils/format";
import type {
  LibraryAudioTrack,
  LibraryFileInfo,
  LibrarySubtitleTrack,
} from "@rawkoon/shared/types";
import { Row, SectionTitle } from "./LibrarySharedUI";
import { formatDuration, formatResolution } from "@/utils/libraryDisplayUtils";
import { useUpdateMediaFile } from "@/features/medias/hooks/useUpdateMediaFile";
import { ReencodeModal } from "@/features/transcode/ReencodeModal";
import { AudioTrackRow, SubtitleTrackRow } from "./LibraryFileTrackRows";
import { RemuxPanel } from "./LibraryRemuxPanel";

export function FileDetailBlock({
  file,
  showActions = true,
}: {
  file: LibraryFileInfo;
  /** Off where the caller already offers re-encode and remux for the file. */
  showActions?: boolean;
}) {
  const { t } = useTranslation("common");
  const [showRemux, setShowRemux] = useState(false);
  const [showReencode, setShowReencode] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupValue, setGroupValue] = useState(file.release_group ?? "");
  const updateFile = useUpdateMediaFile();
  const audioTracks = (file.audio_tracks ?? []) as LibraryAudioTrack[];
  const subtitleTracks = (file.subtitle_tracks ?? []) as LibrarySubtitleTrack[];
  const isMkv = file.file_name.toLowerCase().endsWith(".mkv");
  const scannedDate = new Date(file.scanned_at).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });

  return (
    <div>
      <SectionTitle
        icon={HardDrive}
        label={t("library.fileDetail.sectionFile")}
      />
      <div className="space-y-1">
        <Row label={t("library.fileDetail.name")} value={file.file_name} mono />
        <Row
          label={t("library.fileDetail.size")}
          value={formatBytes(Number(file.size_bytes))}
        />
        <Row
          label={t("library.fileDetail.duration")}
          value={formatDuration(file.duration_secs)}
        />
        {editingGroup ? (
          <div className="flex gap-2 text-xs items-center">
            <span className="w-[34%] shrink-0 text-neutral-400">
              {t("library.fileDetail.releaseGroup")}
            </span>
            <input
              autoFocus
              value={groupValue}
              onChange={(e) => setGroupValue(e.target.value)}
              onBlur={async () => {
                setEditingGroup(false);
                const val = groupValue.trim() || null;
                if (val === (file.release_group ?? null)) return;
                try {
                  await updateFile.mutateAsync({
                    fileId: file.id,
                    release_group: val,
                  });
                } catch {
                  toast.error(t("library.fileDetail.updateReleaseGroupFailed"));
                  setGroupValue(file.release_group ?? "");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditingGroup(false);
                  setGroupValue(file.release_group ?? "");
                }
              }}
              className="focus-ring flex-1 rounded border border-neutral-600 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-200"
            />
          </div>
        ) : (
          <div
            className="flex gap-2 text-xs items-center group cursor-pointer"
            onClick={() => setEditingGroup(true)}
            title={t("library.fileDetail.editReleaseGroup")}
          >
            <span className="w-[34%] shrink-0 text-neutral-400">
              {t("library.fileDetail.releaseGroup")}
            </span>
            <span className="min-w-0 flex-1 text-neutral-200">
              {file.release_group ?? (
                <span className="text-neutral-500 italic text-[10px]">—</span>
              )}
              <Pencil
                size={9}
                className="inline ml-1.5 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </span>
          </div>
        )}
        {file.file_path && (
          <Row
            label={t("library.fileDetail.path")}
            value={file.file_path}
            mono
          />
        )}
      </div>

      <SectionTitle icon={Film} label={t("library.fileDetail.sectionVideo")} />
      <div className="space-y-1">
        <Row
          label={t("library.fileDetail.codec")}
          value={[file.video_codec, file.video_profile]
            .filter(Boolean)
            .join(" · ")}
        />
        <Row
          label={t("library.fileDetail.resolution")}
          value={formatResolution(file.resolution, file.width, file.height)}
        />
        <Row
          label={t("library.fileDetail.bitDepth")}
          value={
            file.bit_depth
              ? t("library.fileDetail.bitDepthValue", { bits: file.bit_depth })
              : null
          }
        />
        <Row label={t("library.fileDetail.hdr")} value={file.hdr_format} />
        <Row label={t("library.fileDetail.source")} value={file.source} />
        <Row
          label={t("library.fileDetail.bitrate")}
          value={
            file.video_bitrate
              ? t("library.fileDetail.bitrateKbps", {
                  value: file.video_bitrate.toLocaleString(),
                })
              : null
          }
        />
        <Row
          label={t("library.fileDetail.frameRate")}
          value={
            file.frame_rate
              ? t("library.fileDetail.frameRateFps", {
                  value: String(file.frame_rate),
                })
              : null
          }
        />
      </div>

      {audioTracks.length > 0 && (
        <>
          <SectionTitle
            icon={Music}
            label={t("library.fileDetail.audioTracksHeading", {
              count: audioTracks.length,
            })}
          />
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {audioTracks.map((tr) => (
              <div key={tr.index} className="px-2.5">
                <AudioTrackRow track={tr} />
              </div>
            ))}
          </div>
        </>
      )}

      {subtitleTracks.length > 0 && (
        <>
          <SectionTitle
            icon={Subtitles}
            label={t("library.fileDetail.subtitlesTracksHeading", {
              count: subtitleTracks.length,
            })}
          />
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {subtitleTracks.map((tr) => (
              <div key={tr.index} className="px-2.5">
                <SubtitleTrackRow track={tr} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-neutral-500">
          <Clock size={9} className="inline mr-1" />
          {t("library.fileDetail.scanned", { date: scannedDate })}
        </span>
        {showActions && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowReencode(true)}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
            >
              <Gauge size={10} />
              {t("transcode.openButton")}
            </button>
            {isMkv && audioTracks.length > 1 && !showRemux && (
              <button
                type="button"
                onClick={() => setShowRemux(true)}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
              >
                <Shuffle size={10} />
                {t("library.fileDetail.remux.openButton")}
              </button>
            )}
          </div>
        )}
      </div>

      {showActions && (
        <ReencodeModal
          isOpen={showReencode}
          onClose={() => setShowReencode(false)}
          selection={{ file_ids: [file.id] }}
          subtitle={file.file_name}
        />
      )}

      {showActions && showRemux && (
        <RemuxPanel file={file} onClose={() => setShowRemux(false)} />
      )}
    </div>
  );
}
