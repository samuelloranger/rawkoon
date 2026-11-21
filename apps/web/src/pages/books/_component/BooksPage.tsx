import { formatBytes } from "@/lib/utils/format";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Headphones,
  Library,
  Plus,
  Trophy,
  UserRound,
} from "lucide-react";
import type {
  Book,
  BookEdition,
  BookEditionKind,
  BookListeningProgress,
  BookReadingProgress,
} from "@rawkoon/shared/types";
import { useLibraryEvents } from "@/features/medias/hooks/useLibraryEvents";
import {
  useListeningProgress,
  useReadingProgress,
} from "@/features/player/usePlayback";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { LibrarySwitch } from "@/pages/medias/_component/LibrarySwitch";
import { Button } from "@/components/ui/button";
import {
  ActiveFilterChips,
  FilterButton,
  FilterGroup,
  FilterPanel,
  FilterSegmented,
  ToolbarSearch,
} from "@/components/ui/filter-panel";
import { ViewToggle } from "@/components/ui/view-toggle";
import { useBooks } from "../_hooks/useBooks";
import { LoadError } from "@/components/LoadError";
import { AddBookDialog } from "./AddBookDialog";
import { BookCover } from "./BookCover";
import { BookGrid } from "./BookGrid";
import { BookReadBadge, BookReadContextMenu } from "./BookReadActions";
import { aggregateState, byKindOrder, stateTokens } from "./bookState";

const formatSize = (raw: string | null): string => {
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? formatBytes(n) : "";
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
        {edition.file_count > 0 ? formatSize(edition.total_size_bytes) : ""}
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
          {book.read_at && (
            <div className="mt-1">
              <BookReadBadge />
            </div>
          )}
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

type BooksViewMode = "grid" | "compact" | "list";

const BOOK_VIEW_MODES = ["grid", "compact", "list"] as const;
const SEARCH_DEBOUNCE_MS = 250;

const VIEW_STORAGE_KEY = "rawkoon.books.viewMode";

/**
 * The choice outlives the visit.
 *
 * Books has no URL state of its own, unlike the media library, so the view
 * lives in localStorage: picking the shelf and finding the ledger again on the
 * next visit would read as the app forgetting.
 */
const readStoredView = (): BooksViewMode => {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "list" || stored === "compact" ? stored : "grid";
  } catch {
    // Private mode, or storage disabled — the default is still a valid view.
    return "grid";
  }
};

/**
 * Default order: the books you are still in the middle of, most recently
 * touched first, then everything else in the server's latest-added order.
 *
 * "Still in the middle of" is the same in-progress test the Continue shelf
 * uses — some real progress, not finished. A book with several editions floats
 * on whichever edition was touched last.
 */
const sortByActivity = (
  books: Book[],
  listening: BookListeningProgress[],
  reading: BookReadingProgress[],
): Book[] => {
  const lastRead = new Map<number, string>();
  const note = (bookId: number, updatedAt: string) => {
    const prev = lastRead.get(bookId);
    if (prev === undefined || prev < updatedAt) lastRead.set(bookId, updatedAt);
  };
  for (const r of listening) {
    if (!r.finished && r.position_secs > 1 && r.total_duration_secs > 1)
      note(r.book_id, r.updated_at);
  }
  for (const r of reading) {
    if (!r.finished && (r.spine_index > 0 || r.scroll_fraction > 0.01))
      note(r.book_id, r.updated_at);
  }

  // Stable sort: books with no active read keep the server's added_at order.
  return [...books].sort((a, b) => {
    const ta = lastRead.get(a.id);
    const tb = lastRead.get(b.id);
    if (ta && tb) return ta < tb ? 1 : ta > tb ? -1 : 0;
    if (ta) return -1;
    if (tb) return 1;
    return 0;
  });
};

export function BooksPage() {
  const { t } = useTranslation("common");
  // Server-pushed updates, same stream the media pages use. No polling.
  useLibraryEvents();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [kind, setKind] = useState<BookEditionKind | "all">("all");
  const [showAdd, setShowAdd] = useState(false);
  const isAdmin = useCurrentUser().data?.is_admin ?? false;
  const [view, setView] = useState<BooksViewMode>(readStoredView);

  useEffect(() => {
    const id = setTimeout(
      () => setSubmitted(search.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [search]);

  const changeView = (next: BooksViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice must not break making it.
    }
  };

  const { data, isLoading, isError, refetch, isRefetching } = useBooks({
    q: submitted || undefined,
    kind: kind === "all" ? undefined : kind,
    limit: 100,
  });
  // Reading/listening progress drives the default order. Both are small,
  // per-user, and already cached by the Continue shelf and the players.
  const { data: listening } = useListeningProgress();
  const { data: reading } = useReadingProgress();

  const books = useMemo(
    () =>
      sortByActivity(
        data?.items ?? [],
        listening?.progress ?? [],
        reading?.progress ?? [],
      ),
    [data, listening, reading],
  );

  return (
    <PageLayout>
      <LibrarySwitch active="books" />
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
              to="/find/bestsellers"
              className="focus-ring inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
            >
              <Trophy className="h-4 w-4" />
              {t("books.explore.link")}
            </Link>
            <Link
              to="/books/authors"
              className="focus-ring inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
            >
              <UserRound className="h-4 w-4" />
              {t("books.authorsLink")}
            </Link>
            <Link
              to="/books/listening"
              className="focus-ring inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
            >
              <Headphones className="h-4 w-4" />
              {t("books.listeningLink")}
            </Link>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {isAdmin ? t("books.addBook") : t("books.requestBook")}
            </Button>
          </div>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarSearch
            value={search}
            onChange={setSearch}
            placeholder={t("books.searchPlaceholder")}
            className="w-full sm:w-auto sm:max-w-md sm:flex-1"
          />
          <FilterPanel
            trigger={<FilterButton count={kind === "all" ? 0 : 1} />}
            title={t("filters.title")}
            resultCount={
              data ? t("books.resultCount", { count: data.total }) : null
            }
            onReset={kind === "all" ? undefined : () => setKind("all")}
          >
            <FilterGroup label={t("books.kindSection")}>
              <FilterSegmented
                ariaLabel={t("books.kindSection")}
                options={(["all", "audiobook", "ebook"] as const).map((k) => ({
                  id: k,
                  label: t(`books.kindOptions.${k}`),
                }))}
                value={kind}
                onChange={setKind}
              />
            </FilterGroup>
          </FilterPanel>
          <ViewToggle
            value={view}
            onChange={changeView}
            modes={BOOK_VIEW_MODES}
            className="ml-auto"
          />
        </div>
        <ActiveFilterChips
          chips={
            kind === "all"
              ? []
              : [
                  {
                    id: "kind",
                    label: t(`books.kindOptions.${kind}`),
                    onRemove: () => setKind("all"),
                  },
                ]
          }
          onClearAll={() => setKind("all")}
        />
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          {t("books.loading")}
        </p>
      ) : isError && !data ? (
        <LoadError onRetry={() => void refetch()} retrying={isRefetching} />
      ) : books.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-800 py-16 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-neutral-700" />
          <p className="mt-3 text-sm text-neutral-400">
            {submitted ? t("books.noneMatch") : t("books.noneYet")}
          </p>
          {!submitted && isAdmin && (
            <Button className="mt-4" onClick={() => setShowAdd(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("books.addFirst")}
            </Button>
          )}
        </div>
      ) : view !== "list" ? (
        <BookGrid books={books} compact={view === "compact"} />
      ) : (
        <ul className="space-y-2">
          {books.map((b) => (
            <li key={b.id}>
              <BookReadContextMenu book={b}>
                <BookRow book={b} />
              </BookReadContextMenu>
            </li>
          ))}
        </ul>
      )}

      {showAdd && <AddBookDialog onClose={() => setShowAdd(false)} />}
    </PageLayout>
  );
}
