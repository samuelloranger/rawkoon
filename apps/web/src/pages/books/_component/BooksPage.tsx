import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Headphones,
  Library,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import type { Book, BookEdition, BookEditionKind } from "@rawkoon/shared/types";
import { useLibraryEvents } from "@/features/medias/hooks/useLibraryEvents";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBooks } from "../_hooks/useBooks";
import { AddBookDialog } from "./AddBookDialog";
import { BookCover } from "./BookCover";
import { aggregateState, byKindOrder, stateTokens } from "./bookState";

const formatBytes = (raw: string | null): string => {
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return "";
  const mb = n / 1_048_576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  // A decimal below 10 MB: most ebooks live there, and rounding turned every
  // one of them into "1 MB".
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
};

/**
 * One edition as a ledger line.
 *
 * The list used to put two small chips under the title and leave the right two
 * thirds of every row empty. Someone scanning their library wants to compare
 * the same fact down a column — is the ebook here, is the audiobook here, what
 * format, how big — so editions are set as aligned columns instead, the way a
 * library card carries its circulation stamps.
 */
function EditionLedgerLine({ edition }: { edition: BookEdition }) {
  const { t } = useTranslation("common");
  const tokens = stateTokens(edition.status);
  const Icon = edition.kind === "audiobook" ? Headphones : BookOpen;

  return (
    <div className="flex items-center gap-3 text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
      <span className="w-[84px] shrink-0 font-medium uppercase tracking-wider text-neutral-400">
        {t(`books.kind${edition.kind === "audiobook" ? "Audiobook" : "Ebook"}`)}
      </span>
      {/* Format and size are machine strings: mono face, fixed columns. That
          alignment is what makes the column scannable. */}
      <span className="w-10 shrink-0 font-mono text-[11px] uppercase text-primary-300">
        {edition.best_format ?? ""}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-neutral-500">
        {edition.file_count > 0 ? formatBytes(edition.total_size_bytes) : ""}
      </span>
      <span className={`w-24 shrink-0 text-right ${tokens.text}`}>
        {t(`books.status.${edition.status}`, { defaultValue: edition.status })}
      </span>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tokens.dot}`} />
    </div>
  );
}

/** Compact edition state for narrow screens, where the ledger has no room. */
function EditionChips({ editions }: { editions: BookEdition[] }) {
  const { t } = useTranslation("common");
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {byKindOrder(editions).map((e) => {
        const Icon = e.kind === "audiobook" ? Headphones : BookOpen;
        return (
          <span
            key={e.id}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${stateTokens(e.status).chip}`}
          >
            <Icon className="h-3 w-3" />
            {t(`books.status.${e.status}`, { defaultValue: e.status })}
            {e.best_format && (
              <span className="font-mono text-[10px] uppercase opacity-80">
                {e.best_format}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function BookRow({ book }: { book: Book }) {
  const { t } = useTranslation("common");
  const state = aggregateState(book.editions);
  const rail = state ? stateTokens(state).rail : "bg-neutral-700";

  const meta = [
    book.published_year,
    book.language.toUpperCase(),
    book.series_name
      ? book.series_position != null
        ? t("books.seriesPosition", {
            series: book.series_name,
            position: book.series_position,
          })
        : book.series_name
      : null,
  ].filter(Boolean);

  return (
    <Link
      to="/books/$bookId"
      params={{ bookId: String(book.id) }}
      className="focus-ring flex overflow-hidden rounded-lg border border-neutral-800 bg-surface-raised/40 transition-colors hover:border-neutral-700 hover:bg-surface-raised"
    >
      {/* The spine rail — the same device as the edition panels on the detail
          page, coloured by the least-finished edition so a row never claims to
          be complete while something is still missing. */}
      <span aria-hidden className={`w-1 shrink-0 ${rail}`} />

      <div className="flex min-w-0 flex-1 items-center gap-3 p-3 sm:gap-4">
        <BookCover title={book.title} coverUrl={book.cover_url} />

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[17px] leading-snug text-neutral-50">
            {book.title}
          </p>
          <p className="truncate text-sm text-neutral-300">
            {book.authors.join(", ") || t("books.unknownAuthor")}
          </p>
          {meta.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              {meta.join(" · ")}
            </p>
          )}
          <div className="lg:hidden">
            <EditionChips editions={book.editions} />
          </div>
        </div>

        <div className="hidden shrink-0 flex-col items-end gap-1.5 lg:flex">
          {byKindOrder(book.editions).map((e) => (
            <EditionLedgerLine key={e.id} edition={e} />
          ))}
        </div>
      </div>
    </Link>
  );
}

export function BooksPage() {
  const { t } = useTranslation("common");
  // Server-pushed updates, same stream the media pages use. No polling.
  useLibraryEvents();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [kind, setKind] = useState<BookEditionKind | undefined>();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useBooks({
    q: submitted || undefined,
    kind,
    limit: 100,
  });

  const books = data?.items ?? [];

  return (
    <PageLayout>
      <PageHeader
        icon={Library}
        title={t("books.title")}
        subtitle={
          data
            ? t("books.subtitleCount", { count: data.total })
            : t("books.subtitleEmpty")
        }
        onRefresh={() => void refetch()}
        isRefreshing={isRefetching}
        actions={
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            {/* A styled Link, not <Button asChild>: Button never implemented
                asChild, so the prop reached the DOM and the anchor's icon and
                label stacked on top of each other. */}
            <Link
              to="/books/authors"
              className="focus-ring inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
            >
              <UserRound className="h-4 w-4" />
              {t("books.authorsLink")}
            </Link>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("books.addBook")}
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="flex w-full gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(search.trim());
          }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("books.filterPlaceholder")}
            className="w-full sm:w-56"
          />
          <Button
            type="submit"
            variant="secondary"
            size="icon"
            aria-label={t("books.search")}
          >
            <Search className="h-4 w-4" />
          </Button>
        </form>

        <div className="flex gap-1.5">
          {([undefined, "ebook", "audiobook"] as const).map((k) => (
            <button
              key={k ?? "all"}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`focus-ring rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                kind === k
                  ? "bg-primary-500/15 text-primary-200"
                  : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {k
                ? t(`books.kind${k === "audiobook" ? "Audiobook" : "Ebook"}`)
                : t("books.kindAll")}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          {t("books.loading")}
        </p>
      ) : books.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-800 py-16 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-neutral-700" />
          <p className="mt-3 text-sm text-neutral-400">
            {submitted ? t("books.noneMatch") : t("books.noneYet")}
          </p>
          {!submitted && (
            <Button className="mt-4" onClick={() => setShowAdd(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("books.addFirst")}
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {books.map((b) => (
            <li key={b.id}>
              <BookRow book={b} />
            </li>
          ))}
        </ul>
      )}

      {showAdd && <AddBookDialog onClose={() => setShowAdd(false)} />}
    </PageLayout>
  );
}
