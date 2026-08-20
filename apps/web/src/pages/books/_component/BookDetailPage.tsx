import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  Download,
  Headphones,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type {
  BookEdition,
  BookEditionKind,
  BookRelease,
} from "@rawkoon/shared/types";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import {
  useAddEdition,
  useBook,
  useBookQualityProfiles,
  useDeleteBook,
  useEditionFiles,
  useGrabRelease,
  useReleaseSearch,
  useUpdateEdition,
} from "../_hooks/useBooks";

const formatBytes = (raw: string | null): string => {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return "—";
  const mb = n / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
};

const formatDuration = (secs: number | null): string => {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function ReleaseList({
  bookId,
  kind,
}: {
  bookId: number;
  kind: BookEditionKind;
}) {
  const [enabled, setEnabled] = useState(false);
  const { data, isFetching, error } = useReleaseSearch(bookId, kind, enabled);
  const grab = useGrabRelease(bookId);
  const [showRejected, setShowRejected] = useState(false);

  const releases = data?.releases ?? [];
  const accepted = releases.filter((r) => !r.rejected);
  const rejected = releases.filter((r) => r.rejected);
  const visible: BookRelease[] = showRejected ? releases : accepted;

  const searchError =
    error instanceof ApiError ? error.message : error ? "Search failed" : null;

  return (
    <div className="mt-3 border-t border-neutral-800 pt-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setEnabled(true)}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="mr-1.5 h-3.5 w-3.5" />
          )}
          Search indexers
        </Button>
        {rejected.length > 0 && (
          <button
            type="button"
            onClick={() => setShowRejected((v) => !v)}
            className="text-xs text-neutral-500 underline-offset-2 hover:underline"
          >
            {showRejected ? "Hide" : "Show"} {rejected.length} rejected
          </button>
        )}
      </div>

      {searchError && (
        <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {searchError}
        </p>
      )}

      {data?.indexer_warnings.map((w) => (
        <p
          key={w.id}
          className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
        >
          {w.name}: {w.error}
        </p>
      ))}

      {enabled && !isFetching && releases.length === 0 && !searchError && (
        <p className="mt-2 text-sm text-neutral-500">No releases found.</p>
      )}

      {visible.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {visible.map((r) => (
            <li
              key={r.guid}
              className={`rounded-lg border p-2.5 text-sm ${
                r.rejected
                  ? "border-neutral-800 bg-neutral-950/50 opacity-60"
                  : "border-neutral-700"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-mono text-xs text-neutral-200">
                    {r.title}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-neutral-500">
                    {r.format && (
                      <span className="text-primary-400">{r.format}</span>
                    )}
                    {r.audio_bitrate && <span>{r.audio_bitrate} kbps</span>}
                    <span>{formatBytes(String(r.size_bytes ?? 0))}</span>
                    <span>{r.seeders ?? 0} seeders</span>
                    {r.language && <span>{r.language.toUpperCase()}</span>}
                    {r.indexer && <span>{r.indexer}</span>}
                    <span className="text-neutral-600">score {r.score}</span>
                  </p>
                  {/* Rejections are shown verbatim: freetext book search is the
                      weakest link, so seeing WHY a release was dropped is how
                      a profile gets tuned. */}
                  {r.rejected && (
                    <p className="mt-1 text-xs text-rose-400/80">
                      {r.rejections.join(" · ")}
                    </p>
                  )}
                </div>

                {!r.rejected && (
                  <Button
                    size="sm"
                    disabled={grab.isPending}
                    onClick={() =>
                      grab.mutate({
                        kind,
                        release_title: r.title,
                        download_url: r.download_url ?? undefined,
                        magnet_url: r.magnet_url ?? undefined,
                        indexer: r.indexer,
                      })
                    }
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {grab.data && !grab.data.grabbed && (
        <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {grab.data.reason}
        </p>
      )}
      {grab.data?.grabbed && (
        <p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Grabbed {grab.data.release_title}
        </p>
      )}
    </div>
  );
}

function EditionCard({
  bookId,
  edition,
}: {
  bookId: number;
  edition: BookEdition;
}) {
  const update = useUpdateEdition(bookId);
  const { data: profilesData } = useBookQualityProfiles();
  const [showFiles, setShowFiles] = useState(false);
  const { data: filesData } = useEditionFiles(bookId, edition.kind, showFiles);

  const Icon = edition.kind === "audiobook" ? Headphones : BookOpen;
  // A profile scoped to the other kind must not be offered here — the API
  // refuses it, so filtering keeps the UI honest rather than error-prone.
  const profiles = (profilesData?.profiles ?? []).filter(
    (p) => p.kind === "both" || p.kind === edition.kind,
  );

  return (
    <div className="rounded-xl border border-neutral-800 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon className="h-4 w-4 text-primary-400" />
        <span className="font-medium capitalize text-neutral-100">
          {edition.kind}
        </span>
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
          {edition.status}
        </span>
        {edition.best_format && (
          <span className="rounded-full bg-primary-500/15 px-2 py-0.5 text-xs text-primary-300">
            {edition.best_format}
          </span>
        )}

        <label className="ml-auto flex items-center gap-2 text-sm text-neutral-400">
          <input
            type="checkbox"
            checked={edition.monitored}
            onChange={(e) =>
              update.mutate({
                kind: edition.kind,
                monitored: e.target.checked,
              })
            }
            className="h-4 w-4 rounded border-neutral-700 bg-neutral-800"
          />
          Monitored
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span>Size {formatBytes(edition.total_size_bytes)}</span>
        {edition.kind === "audiobook" && (
          <span>Duration {formatDuration(edition.duration_secs)}</span>
        )}
        <span>{edition.file_count} file(s)</span>
        {edition.narrators.length > 0 && (
          <span>Narrated by {edition.narrators.join(", ")}</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={edition.book_quality_profile_id ?? ""}
          onChange={(e) =>
            update.mutate({
              kind: edition.kind,
              book_quality_profile_id: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
          className="rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
        >
          <option value="">No profile</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {edition.file_count > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowFiles((v) => !v)}
          >
            {showFiles ? "Hide" : "Show"} files
          </Button>
        )}
      </div>

      {showFiles && filesData && (
        <ul className="mt-2 space-y-1 border-t border-neutral-800 pt-2">
          {filesData.files.map((f) => (
            <li key={f.id} className="text-xs text-neutral-400">
              <span className="text-primary-400">{f.format}</span>{" "}
              <span className="break-all">{f.file_name}</span>{" "}
              <span className="text-neutral-600">
                {formatBytes(f.size_bytes)}
                {f.audio_bitrate ? ` · ${f.audio_bitrate} kbps` : ""}
                {f.is_retail ? " · retail" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ReleaseList bookId={bookId} kind={edition.kind} />
    </div>
  );
}

export function BookDetailPage({ bookId }: { bookId: number }) {
  const { data, isLoading } = useBook(bookId);
  const addEdition = useAddEdition(bookId);
  const deleteBook = useDeleteBook();

  if (isLoading) {
    return (
      <PageLayout>
        <p className="py-12 text-center text-sm text-neutral-500">Loading…</p>
      </PageLayout>
    );
  }

  const book = data?.item;
  if (!book) {
    return (
      <PageLayout>
        <p className="py-12 text-center text-sm text-neutral-500">
          Book not found.
        </p>
      </PageLayout>
    );
  }

  const existingKinds = new Set(book.editions.map((e) => e.kind));
  const missingKinds = (["ebook", "audiobook"] as BookEditionKind[]).filter(
    (k) => !existingKinds.has(k),
  );

  return (
    <PageLayout>
      <Link
        to="/books"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Books
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="h-56 w-36 shrink-0 overflow-hidden rounded-lg bg-neutral-950 ring-1 ring-primary-500/20">
          {book.cover_url ? (
            <img
              src={book.cover_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <BookOpen className="h-8 w-8 text-neutral-700" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-neutral-100">
            {book.title}
          </h1>
          {book.subtitle && (
            <p className="mt-0.5 text-neutral-400">{book.subtitle}</p>
          )}
          <p className="mt-2 text-sm text-neutral-400">
            {book.authors.join(", ") || "Unknown author"}
            {book.published_year ? ` · ${book.published_year}` : ""}
            {` · ${book.language.toUpperCase()}`}
          </p>
          {book.series_name && (
            <p className="text-sm text-neutral-500">
              {book.series_name}
              {book.series_position != null ? ` #${book.series_position}` : ""}
            </p>
          )}
          {book.isbn13 && (
            <p className="mt-1 font-mono text-xs text-neutral-600">
              ISBN {book.isbn13}
            </p>
          )}
          {book.overview && (
            <p className="mt-3 text-sm leading-relaxed text-neutral-300">
              {book.overview}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {missingKinds.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant="secondary"
                disabled={addEdition.isPending}
                onClick={() => addEdition.mutate({ kind })}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add {kind}
              </Button>
            ))}
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteBook.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Remove "${book.title}" from the library? Files on disk are left alone.`,
                  )
                ) {
                  deleteBook.mutate(book.id);
                }
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {book.editions.map((e) => (
          <EditionCard key={e.id} bookId={book.id} edition={e} />
        ))}
      </div>
    </PageLayout>
  );
}
