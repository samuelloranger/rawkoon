import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { BookOpen, Headphones } from "lucide-react";
import type { Book } from "@rawkoon/shared/types";
import { BookCover } from "./BookCover";
import { aggregateState, byKindOrder, stateTokens } from "./bookState";

/**
 * The shelf view.
 *
 * The list view is a ledger — it exists to compare the same fact down a column.
 * The grid is the opposite errand: recognising a book by its jacket. So the
 * card gives the cover the whole tile and keeps only what survives at that
 * size — which editions exist and how finished they are, as a dot per edition
 * rather than a row of labels nobody can read at 140px wide.
 *
 * Columns match the media grid's breakpoints so the two libraries feel like the
 * same app, but the tiles are 2:3 book covers, not posters.
 */

/** One edition as a single icon + status dot, legible at tile scale. */
function EditionPip({ kind, status }: { kind: string; status: string }) {
  const { t } = useTranslation("common");
  const Icon = kind === "audiobook" ? Headphones : BookOpen;
  const tokens = stateTokens(status);
  const label = `${t(`books.kind${kind === "audiobook" ? "Audiobook" : "Ebook"}`)} · ${t(
    `books.status.${status}`,
    { defaultValue: status },
  )}`;

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 backdrop-blur-sm"
    >
      <Icon className="h-3 w-3 text-neutral-300" />
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tokens.dot}`} />
    </span>
  );
}

function BookTile({ book }: { book: Book }) {
  const { t } = useTranslation("common");
  const state = aggregateState(book.editions);
  const rail = state ? stateTokens(state).rail : "bg-neutral-700";

  const series = book.series_name
    ? book.series_position != null
      ? t("books.seriesPosition", {
          series: book.series_name,
          position: book.series_position,
        })
      : book.series_name
    : null;

  return (
    <Link
      to="/books/$bookId"
      params={{ bookId: String(book.id) }}
      className="focus-ring group flex flex-col gap-2"
    >
      <div className="relative">
        {/* No alt: the tile's visible title is inside the same link, so an
            alt here would have every book announced twice. */}
        <BookCover
          title={book.title}
          author={book.authors[0] ?? null}
          coverUrl={book.cover_url}
          size="grid"
        />

        {/* The same spine rail the row and the detail panels use, so a book's
            state reads identically in every view. */}
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-1 rounded-l-sm ${rail}`}
        />

        <div className="absolute right-1 top-1 flex flex-col items-end gap-1">
          {byKindOrder(book.editions).map((e) => (
            <EditionPip key={e.id} kind={e.kind} status={e.status} />
          ))}
        </div>

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-sm ring-0 ring-primary-500/0 transition-all group-hover:ring-2 group-hover:ring-primary-500/40"
        />
      </div>

      <div className="min-w-0">
        <p className="truncate font-display text-sm leading-snug text-neutral-100">
          {book.title}
        </p>
        <p className="truncate text-xs text-neutral-400">
          {book.authors.join(", ") || t("books.unknownAuthor")}
        </p>
        {series && (
          <p className="truncate text-[11px] text-neutral-500">{series}</p>
        )}
      </div>
    </Link>
  );
}

export function BookGrid({ books }: { books: Book[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {books.map((b) => (
        <li key={b.id}>
          <BookTile book={b} />
        </li>
      ))}
    </ul>
  );
}
