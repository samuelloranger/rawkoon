import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, FolderSearch, Headphones, Loader2 } from "lucide-react";
import {
  formatDurationCompactSeconds,
  type BookEdition,
} from "@rawkoon/shared";
import { Button } from "@/components/ui/button";
import { EditionOpenActions } from "@/features/books/EditionOpenActions";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/client";
import {
  useBookQualityProfiles,
  useEditionFiles,
  useRescanEdition,
  useUpdateEdition,
} from "../_hooks/useBooks";
import { AcquisitionTrack } from "./AcquisitionTrack";
import { ReleaseList } from "./ReleaseList";
import { stateTokens } from "./bookState";
import { NO_PROFILE, formatBytes } from "./bookDetailFormat";

/**
 * One edition, presented as a spined object. The vertical stamp on the spine is
 * the page's signature: it names the format the way a book names itself on a
 * shelf, and its colour carries the state.
 */
export function EditionPanel({
  bookId,
  edition,
  isAdmin,
}: {
  bookId: number;
  edition: BookEdition;
  /** Monitoring, profile, rescan and release search are admin-only. */
  isAdmin: boolean;
}) {
  const { t } = useTranslation("common");
  const update = useUpdateEdition(bookId);
  const rescan = useRescanEdition(bookId);
  const { data: profilesData } = useBookQualityProfiles();
  const [showFiles, setShowFiles] = useState(false);
  const { data: filesData } = useEditionFiles(bookId, edition.kind, showFiles);

  const Icon = edition.kind === "audiobook" ? Headphones : BookOpen;
  // A profile scoped to the other kind is refused by the API, so filtering here
  // keeps the control honest instead of error-prone.
  const profiles = (profilesData?.profiles ?? []).filter(
    (p) => p.kind === "both" || p.kind === edition.kind,
  );
  const spine = stateTokens(edition.status).rail;
  // Interpolated into prose, so it has to be the translated word rather than
  // the server's "ebook" / "audiobook".
  const kindLabel = t(
    `books.kind${edition.kind === "audiobook" ? "Audiobook" : "Ebook"}`,
  );
  const stamp = edition.best_format ?? edition.kind;

  return (
    <section className="relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
      <div className="flex">
        {/* The spine. */}
        <div
          className={`flex w-9 shrink-0 items-center justify-center ${spine}`}
        >
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-neutral-950/80"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {stamp}
          </span>
        </div>

        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Icon className="h-4 w-4 shrink-0 text-primary-400" />
            <h3 className="font-display text-lg capitalize text-neutral-50">
              {kindLabel}
            </h3>

            {/* A Switch, not a checkbox: the authors page already expresses
                monitoring this way, and the same idea should not wear two
                different controls in one feature. */}
            {isAdmin && (
              <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 text-sm text-neutral-300">
                {t("books.edition.monitored")}
                <Switch
                  checked={edition.monitored}
                  onCheckedChange={(checked) =>
                    update.mutate({ kind: edition.kind, monitored: checked })
                  }
                />
              </label>
            )}
          </header>

          <div className="mt-4">
            <AcquisitionTrack edition={edition} />
          </div>

          <EditionOpenActions edition={edition} bookId={bookId} />

          {/* Only shown once there is something to report: an edition with no
              files rendered "Size —, Files 0", which is noise dressed as data. */}
          {edition.file_count > 0 && (
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <div>
                <dt className="text-neutral-500">{t("books.edition.size")}</dt>
                <dd className="mt-0.5 text-neutral-200">
                  {formatBytes(edition.total_size_bytes)}
                </dd>
              </div>
              {edition.kind === "audiobook" && (
                <div>
                  <dt className="text-neutral-500">
                    {t("books.edition.duration")}
                  </dt>
                  <dd className="mt-0.5 text-neutral-200">
                    {formatDurationCompactSeconds(edition.duration_secs, {
                      rounding: "round",
                    }) ?? "—"}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-neutral-500">{t("books.edition.files")}</dt>
                <dd className="mt-0.5 text-neutral-200">
                  {edition.file_count}
                </dd>
              </div>
              {edition.narrators.length > 0 && (
                <div className="min-w-0">
                  <dt className="text-neutral-500">
                    {t("books.edition.narratedBy")}
                  </dt>
                  <dd className="mt-0.5 truncate text-neutral-200">
                    {edition.narrators.join(", ")}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isAdmin && (
              <Select
                value={
                  edition.book_quality_profile_id != null
                    ? String(edition.book_quality_profile_id)
                    : NO_PROFILE
                }
                onValueChange={(value) =>
                  update.mutate({
                    kind: edition.kind,
                    book_quality_profile_id:
                      value === NO_PROFILE ? null : Number(value),
                  })
                }
              >
                <SelectTrigger
                  aria-label={t("books.edition.profileLabel", {
                    kind: kindLabel,
                  })}
                  className="h-9 w-48"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROFILE}>
                    {t("books.edition.noProfile")}
                  </SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {edition.file_count > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowFiles((v) => !v)}
              >
                {showFiles
                  ? t("books.edition.hideFiles")
                  : t("books.edition.showFiles")}
              </Button>
            )}

            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                disabled={rescan.isPending}
                onClick={() => rescan.mutate(edition.kind)}
                title={t("books.edition.rescanHint")}
              >
                {rescan.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderSearch className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t("books.edition.rescan")}
              </Button>
            )}
          </div>

          {rescan.data && (
            <p className="mt-2 text-xs text-neutral-400">
              {rescan.data.registered > 0
                ? t("books.edition.rescanImported", {
                    count: rescan.data.registered,
                    directory: rescan.data.directory,
                  })
                : rescan.data.refreshed > 0
                  ? t("books.edition.rescanUpToDate", {
                      count: rescan.data.refreshed,
                      directory: rescan.data.directory,
                    })
                  : t("books.edition.rescanNothing")}
              {rescan.data.removed > 0
                ? t("books.edition.rescanRemoved", {
                    count: rescan.data.removed,
                  })
                : ""}
            </p>
          )}
          {rescan.isError && (
            <p className="mt-2 text-xs text-rose-300">
              {rescan.error instanceof ApiError
                ? rescan.error.message
                : t("books.edition.rescanFailed")}
            </p>
          )}

          {showFiles && filesData && (
            <ul className="mt-3 space-y-1.5 border-t border-neutral-800 pt-3">
              {filesData.files.map((f) => (
                <li key={f.id} className="text-xs">
                  <span className="font-medium uppercase tracking-wider text-primary-400">
                    {f.format}
                  </span>{" "}
                  {/* File paths are machine strings. */}
                  <span className="break-all font-mono text-neutral-300">
                    {f.file_name}
                  </span>
                  <span className="text-neutral-500">
                    {" · "}
                    {formatBytes(f.size_bytes)}
                    {f.audio_bitrate
                      ? ` · ${t("books.edition.bitrateKbps", { value: f.audio_bitrate })}`
                      : ""}
                    {f.is_retail ? ` · ${t("books.edition.fileRetail")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <ReleaseList
              bookId={bookId}
              kind={edition.kind}
              isPrimary={edition.file_count === 0}
            />
          )}
        </div>
      </div>
    </section>
  );
}
