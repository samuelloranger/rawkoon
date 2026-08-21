import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  FolderSearch,
  Headphones,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  providerHtmlParagraphs,
  type BookEdition,
  type BookEditionKind,
  type BookRelease,
} from "@rawkoon/shared";
import { useLibraryEvents } from "@/features/medias/hooks/useLibraryEvents";
import { PageLayout } from "@/components/PageLayout";
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
  useAddEdition,
  useBook,
  useBookQualityProfiles,
  useClearReleaseSearch,
  useDeleteBook,
  useEditionFiles,
  useGrabRelease,
  useReleaseSearch,
  useRescanEdition,
  useUpdateEdition,
} from "../_hooks/useBooks";
import { BookCover } from "./BookCover";
import { stateTokens } from "./bookState";

/**
 * Book detail.
 *
 * Two ideas drive the layout. First, a book is a physical object, so the cover
 * carries a spine and a page edge and each edition is presented as a spined
 * object rather than a flat card — this is the one place the page spends any
 * decoration. Second, acquisition really is a sequence (wanted, then grabbed,
 * then imported), which is what earns the stepped track: it encodes state the
 * reader needs, and answering "do I have this yet?" at a glance is the page's
 * whole job.
 *
 * Fira Code is reserved for machine strings — identifiers, release names, file
 * paths. Prose gets the body face. That split is semantic, not decorative.
 */

const formatBytes = (raw: string | null): string => {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return "—";
  const mb = n / 1_048_576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  // Same rule as the list, so one book does not report two different sizes.
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
};

const formatDuration = (secs: number | null): string => {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Radix Select has no empty value, so "no profile" needs a sentinel. */
const NO_PROFILE = "none";

type Step = {
  key: string;
  /** Translation key; the label is resolved where it is rendered. */
  labelKey: string;
  reached: boolean;
  active: boolean;
};

/**
 * Derive the acquisition steps from real fields, never from a stored
 * "progress" value that could drift from reality.
 */
function stepsFor(edition: BookEdition): Step[] {
  const grabbed =
    edition.last_grabbed_at !== null ||
    ["downloading", "downloaded", "upgrading"].includes(edition.status);
  const imported = edition.file_count > 0 || edition.status === "downloaded";
  return [
    {
      key: "wanted",
      labelKey: "books.track.wanted",
      reached: true,
      active: !grabbed,
    },
    {
      key: "grabbed",
      labelKey: "books.track.grabbed",
      reached: grabbed,
      active: grabbed && !imported,
    },
    {
      key: "imported",
      labelKey: "books.track.inLibrary",
      reached: imported,
      active: imported,
    },
  ];
}

function AcquisitionTrack({ edition }: { edition: BookEdition }) {
  const { t } = useTranslation("common");
  const steps = stepsFor(edition);
  return (
    <ol className="flex items-center gap-0" aria-label={t("books.track.label")}>
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center">
          {i > 0 && (
            <span
              aria-hidden
              className={`h-px w-8 sm:w-12 ${
                step.reached ? "bg-primary-500/60" : "bg-neutral-700"
              }`}
            />
          )}
          <span className="flex items-center gap-1.5 px-1.5">
            <span
              aria-hidden
              className={`grid h-4 w-4 place-items-center rounded-full border transition-colors ${
                step.reached
                  ? "border-primary-500 bg-primary-500/20"
                  : "border-neutral-700 bg-transparent"
              }`}
            >
              {step.reached && (
                <Check className="h-2.5 w-2.5 text-primary-300" />
              )}
            </span>
            <span
              className={`text-xs ${
                step.active
                  ? "font-medium text-neutral-100"
                  : step.reached
                    ? "text-neutral-400"
                    : "text-neutral-500"
              }`}
            >
              {t(step.labelKey)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ReleaseList({
  bookId,
  kind,
  isPrimary,
}: {
  bookId: number;
  kind: BookEditionKind;
  /** True when the edition holds no files, making the search THE next step. */
  isPrimary: boolean;
}) {
  const { t } = useTranslation("common");
  const [enabled, setEnabled] = useState(false);
  const { data, isFetching, error } = useReleaseSearch(bookId, kind, enabled);
  const grab = useGrabRelease(bookId);
  const [showRejected, setShowRejected] = useState(false);
  const clearResults = useClearReleaseSearch(bookId, kind);

  /**
   * Once a release is grabbed the rest of the list is spent: the choice is made,
   * the edition is downloading, and a second grab on the same edition is
   * refused by the server anyway. Leaving the list up only invites that. So
   * clear it and let the confirmation stand on its own.
   */
  const grabRelease = (release: BookRelease) =>
    grab.mutate(
      {
        kind,
        release_title: release.title,
        download_url: release.download_url ?? undefined,
        magnet_url: release.magnet_url ?? undefined,
        indexer: release.indexer,
      },
      {
        onSuccess: (result) => {
          if (!result.grabbed) return; // rejected — keep the list to retry
          setEnabled(false);
          setShowRejected(false);
          clearResults();
        },
      },
    );

  const releases = data?.releases ?? [];
  const accepted = releases.filter((r) => !r.rejected);
  const rejected = releases.filter((r) => r.rejected);
  const visible: BookRelease[] = showRejected ? releases : accepted;

  const searchError =
    error instanceof ApiError
      ? error.message
      : error
        ? t("books.releases.searchFailed")
        : null;

  return (
    <div className="mt-4 border-t border-neutral-800 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          // An edition with no files has exactly one useful next step, so the
          // search reads as primary there and recedes once files exist.
          variant={isPrimary ? "default" : "secondary"}
          onClick={() => {
            // Drop the previous grab's banner; it refers to the old list.
            grab.reset();
            setEnabled(true);
          }}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t("books.releases.searchIndexers")}
        </Button>
        {rejected.length > 0 && (
          <button
            type="button"
            onClick={() => setShowRejected((v) => !v)}
            className="focus-ring rounded text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
          >
            {showRejected
              ? t("books.releases.hideRejected", { count: rejected.length })
              : t("books.releases.showRejected", { count: rejected.length })}
          </button>
        )}
      </div>

      {searchError && (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {searchError}
        </p>
      )}

      {data?.indexer_warnings.map((w) => (
        <p
          key={w.id}
          className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
        >
          {t("books.releases.indexerWarning", {
            name: w.name,
            error: w.error,
          })}
        </p>
      ))}

      {enabled && !isFetching && releases.length === 0 && !searchError && (
        <p className="mt-3 text-sm text-neutral-500">
          {t("books.releases.none")}
        </p>
      )}

      {visible.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {visible.map((r) => (
            <li
              key={r.guid}
              className={`rounded-lg border px-3 py-2.5 ${
                r.rejected
                  ? "border-neutral-800 bg-neutral-950/40"
                  : "border-neutral-700 bg-neutral-900/40"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* A release name is a machine string, so it gets the mono face. */}
                  <p
                    className={`break-all font-mono text-xs leading-relaxed ${
                      r.rejected ? "text-neutral-500" : "text-neutral-200"
                    }`}
                  >
                    {r.title}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                    {r.format && (
                      <span className="font-medium uppercase tracking-wider text-primary-400">
                        {r.format}
                      </span>
                    )}
                    {r.audio_bitrate && (
                      <span>
                        {t("books.releases.bitrateKbps", {
                          value: r.audio_bitrate,
                        })}
                      </span>
                    )}
                    <span>{formatBytes(String(r.size_bytes ?? 0))}</span>
                    <span>
                      {t("books.releases.seeders", { count: r.seeders ?? 0 })}
                    </span>
                    {r.language && <span>{r.language.toUpperCase()}</span>}
                    {r.indexer && <span>{r.indexer}</span>}
                  </p>
                  {/* Rejections are shown verbatim: freetext book search is the
                      weakest link in the pipeline, and seeing exactly why a
                      release was dropped is how a profile gets tuned. */}
                  {r.rejected && (
                    <p className="mt-1.5 text-xs text-rose-400/80">
                      {r.rejections.join(" · ")}
                    </p>
                  )}
                </div>

                {!r.rejected && (
                  <Button
                    size="sm"
                    disabled={grab.isPending}
                    onClick={() => grabRelease(r)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="sr-only">
                      {t("books.releases.grabAction", { title: r.title })}
                    </span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* A refused grab is a 409, so it arrives as an error, not as data. The
          old check read grab.data — which is undefined on a throw — so reasons
          like "Already downloading" were never shown at all. */}
      {grab.isError && (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {grab.error instanceof ApiError
            ? grab.error.message
            : t("books.releases.grabFailed")}
        </p>
      )}
      {grab.data?.grabbed && (
        <p className="mt-3 rounded-lg bg-primary-500/10 px-3 py-2 text-sm text-primary-200">
          {t("books.releases.grabbed", { title: grab.data.release_title })}
        </p>
      )}
    </div>
  );
}

/**
 * One edition, presented as a spined object. The vertical stamp on the spine is
 * the page's signature: it names the format the way a book names itself on a
 * shelf, and its colour carries the state.
 */
function EditionPanel({
  bookId,
  edition,
}: {
  bookId: number;
  edition: BookEdition;
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
            <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 text-sm text-neutral-300">
              {t("books.edition.monitored")}
              <Switch
                checked={edition.monitored}
                onCheckedChange={(checked) =>
                  update.mutate({ kind: edition.kind, monitored: checked })
                }
              />
            </label>
          </header>

          <div className="mt-4">
            <AcquisitionTrack edition={edition} />
          </div>

          <EditionOpenActions bookId={bookId} edition={edition} />

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
                    {formatDuration(edition.duration_secs)}
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

          <ReleaseList
            bookId={bookId}
            kind={edition.kind}
            isPrimary={edition.file_count === 0}
          />
        </div>
      </div>
    </section>
  );
}

export function BookDetailPage({ bookId }: { bookId: number }) {
  const { t } = useTranslation("common");
  // Server-pushed updates, same stream the media pages use. No polling.
  useLibraryEvents();
  const { data, isLoading } = useBook(bookId);
  const addEdition = useAddEdition(bookId);
  const deleteBook = useDeleteBook();

  if (isLoading) {
    return (
      <PageLayout>
        <p className="py-16 text-center text-sm text-neutral-500">
          {t("books.detail.loading")}
        </p>
      </PageLayout>
    );
  }

  const book = data?.item;
  if (!book) {
    return (
      <PageLayout>
        <p className="py-16 text-center text-sm text-neutral-500">
          {t("books.detail.notFound")}
        </p>
      </PageLayout>
    );
  }

  const existingKinds = new Set(book.editions.map((e) => e.kind));
  const missingKinds = (["ebook", "audiobook"] as BookEditionKind[]).filter(
    (k) => !existingKinds.has(k),
  );

  // Provider descriptions are markup. Sanitized into paragraphs so the prose
  // can be set with real spacing rather than printed with tags showing.
  const paragraphs = providerHtmlParagraphs(book.overview);

  return (
    <PageLayout>
      <Link
        to="/books"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-neutral-400 transition-colors hover:text-neutral-100"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("books.detail.backToBooks")}
      </Link>

      <div className="flex flex-col gap-7 sm:flex-row sm:gap-9">
        {/* One cover component for the list and the hero, so a coverless book
            looks the same in both places — and, since Google Books often has no
            artwork, looks deliberate rather than broken. */}
        <div className="mx-auto shrink-0 sm:mx-0">
          <BookCover
            title={book.title}
            author={book.authors[0] ?? null}
            coverUrl={book.cover_url}
            size="hero"
            alt={t("books.detail.coverAlt", { title: book.title })}
          />
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl leading-tight text-neutral-50 sm:text-4xl">
            {book.title}
          </h1>
          {book.subtitle && (
            <p className="mt-1.5 font-display text-lg text-neutral-300">
              {book.subtitle}
            </p>
          )}

          <p className="mt-3 text-sm text-neutral-300">
            {book.authors.join(", ") || t("books.unknownAuthor")}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
            {book.published_year && <span>{book.published_year}</span>}
            <span aria-hidden>·</span>
            <span>{book.language.toUpperCase()}</span>
            {book.series_name && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {book.series_name}
                  {book.series_position != null
                    ? ` #${book.series_position}`
                    : ""}
                </span>
              </>
            )}
          </p>

          {/* The ISBN is a real identifier someone might look up or paste.
              The provider's volume id was also printed here; it is an internal
              key with no meaning outside this app, so it is gone. */}
          {book.isbn13 && (
            <p className="mt-4 font-mono text-[11px] text-neutral-500">
              {t("books.detail.isbn", { value: book.isbn13 })}
            </p>
          )}
        </div>

        {/* Actions sit at the top right rather than under the metadata, which
            left the whole right half of the header empty and put a destructive
            button in the middle of the reading path. */}
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
          {missingKinds.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="secondary"
              disabled={addEdition.isPending}
              onClick={() => addEdition.mutate({ kind })}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("books.detail.addEdition", {
                kind: t(
                  `books.kind${kind === "audiobook" ? "Audiobook" : "Ebook"}`,
                ),
              })}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            disabled={deleteBook.isPending}
            onClick={() => {
              if (
                window.confirm(
                  t("books.detail.removeConfirm", { title: book.title }),
                )
              ) {
                deleteBook.mutate(book.id);
              }
            }}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t("books.detail.remove")}
          </Button>
        </div>
      </div>

      {/* The one piece of human writing on the page, so it gets a real reading
          measure and paragraph rhythm instead of being crammed into the grid. */}
      {paragraphs.length > 0 && (
        <div className="mt-10 max-w-[62ch]">
          {paragraphs.map((html, i) => (
            <p
              // Safe: sanitizeProviderHtml has already run twice on this string
              // — once on ingest, once in providerHtmlParagraphs. Only bare,
              // attribute-less tags from a fixed allowlist can survive it, so
              // there is no attribute, event handler, or URL vector to exploit.
              dangerouslySetInnerHTML={{ __html: html }}
              key={`para-${i}`}
              className="mt-4 text-[15px] leading-[1.75] text-neutral-300 first:mt-0"
            />
          ))}
        </div>
      )}

      <div className="mt-12">
        <h2 className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">
          {t("books.detail.editionsHeading")}
          <span aria-hidden className="h-px flex-1 bg-neutral-800" />
        </h2>

        <div className="mt-4 space-y-4">
          {book.editions.map((e) => (
            <EditionPanel key={e.id} bookId={book.id} edition={e} />
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
