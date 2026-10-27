import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BookOpen, Clapperboard, Tv } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  BookSearchResult,
  TmdbMediaSearchItem,
} from "@rawkoon/shared/types";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { useQuickSearch } from "@/lib/search/useSearch";
import { useFeatures } from "@/lib/routing/useFeatures";
import { useTmdbMediaSearch } from "@/features/medias/hooks/useTmdbMediaSearch";
import { useBookProviderSearch } from "@/pages/books/_hooks/useBooks";
import { AddBookDialog } from "@/pages/books/_component/AddBookDialog";
import { BookRequestAction } from "@/pages/books/_component/BookRequestAction";
import { ExploreCardDetailDialog } from "@/pages/medias/_component/ExploreCardDetailDialog";
import { displayLibraryStatus } from "@/utils/libraryStatusPresentation";
import { TmdbResultCard } from "@/pages/medias/_component/TmdbResultCard";

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-200">{title}</h2>
      {children}
    </section>
  );
}

const rowClass =
  "focus-ring flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 transition-colors hover:border-neutral-700";

function LibraryGroup({ query }: { query: string }) {
  const { t } = useTranslation("common");
  const { data, isLoading } = useQuickSearch(query.toLowerCase(), {
    enabled: query.length >= 2,
    staleTime: 30_000,
  });
  const medias = data?.medias ?? [];
  const books = data?.books ?? [];
  if (isLoading || (medias.length === 0 && books.length === 0)) return null;

  return (
    <Group title={t("find.groups.library")}>
      <ul className="space-y-2">
        {medias.map((item) => (
          <li key={`media-${item.id}`}>
            <Link
              to="/library/$libraryId"
              params={{ libraryId: String(item.id) }}
              className={rowClass}
            >
              {item.type === "movie" ? (
                <Clapperboard size={18} className="text-neutral-400" />
              ) : (
                <Tv size={18} className="text-neutral-400" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-100">
                  {item.title}
                </span>
                <span className="block truncate text-xs text-neutral-400">
                  {[
                    item.year ?? "",
                    t(
                      `medias.library.itemStatus.${displayLibraryStatus(item.status, item.airing_state)}`,
                      {
                        defaultValue: item.status,
                      },
                    ),
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </span>
              </span>
            </Link>
          </li>
        ))}
        {books.map((item) => (
          <li key={`book-${item.id}`}>
            <Link
              to="/books/$bookId"
              params={{ bookId: String(item.id) }}
              className={rowClass}
            >
              <BookOpen size={18} className="text-neutral-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-100">
                  {item.title}
                </span>
                <span className="block truncate text-xs text-neutral-400">
                  {[item.authors.join(", "), item.year ?? ""]
                    .filter(Boolean)
                    .join(" • ")}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Group>
  );
}

function TitlesGroup({ query }: { query: string }) {
  const { t, i18n } = useTranslation("common");
  const [selected, setSelected] = useState<TmdbMediaSearchItem | null>(null);
  const search = useTmdbMediaSearch(query, {
    enabled: query.length >= 2,
    language: i18n.language,
  });
  const items = search.data?.items ?? [];

  return (
    <Group title={t("find.groups.titles")}>
      {search.isLoading ? (
        <p className="text-sm text-neutral-400">{t("medias.tmdb.searching")}</p>
      ) : search.isError ? (
        <p role="alert" className="text-sm text-amber-300">
          {t("medias.tmdb.searchFailed")}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-400">{t("medias.tmdb.noResults")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <TmdbResultCard
              key={item.id}
              item={item}
              onOpenDetails={() => setSelected(item)}
              onAdded={() => void search.refetch()}
            />
          ))}
        </div>
      )}
      {selected && (
        <ExploreCardDetailDialog
          item={selected}
          isOpen
          onClose={() => setSelected(null)}
          onAdded={() => {
            setSelected(null);
            void search.refetch();
          }}
        />
      )}
    </Group>
  );
}

function BookRow({
  book,
  isAdmin,
  onAdd,
}: {
  book: BookSearchResult;
  isAdmin: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <li className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-neutral-950">
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <BookOpen className="h-4 w-4 text-neutral-700" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-100">
          {book.title}
        </p>
        <p className="truncate text-xs text-neutral-400">
          {[
            book.authors.join(", ") || t("books.unknownAuthor"),
            book.published_year ?? "",
          ]
            .filter(Boolean)
            .join(" • ")}
        </p>
      </div>
      {isAdmin ? (
        <button
          type="button"
          onClick={onAdd}
          className="focus-ring shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-primary-500"
        >
          {t("books.add.addAction")}
        </button>
      ) : (
        <BookRequestAction
          book={{
            google_volume_id: book.google_volume_id,
            title: book.title,
            author: book.authors.join(", ") || null,
            poster_url: book.cover_url,
            year: book.published_year,
          }}
          request={book.request}
        />
      )}
    </li>
  );
}

/** Google Books is rate-limited, so the books group waits out typing before it searches. */
const BOOKS_DEBOUNCE_MS = 450;
const BOOKS_MIN_QUERY = 3;

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function BooksGroup({ query }: { query: string }) {
  const { t } = useTranslation("common");
  const { data: me } = useCurrentUser();
  const [adding, setAdding] = useState(false);
  const settled = useDebounced(query, BOOKS_DEBOUNCE_MS);
  const search = useBookProviderSearch(
    settled,
    settled.length >= BOOKS_MIN_QUERY,
  );
  if (query.length < BOOKS_MIN_QUERY) return null;

  const waiting = settled !== query || search.isLoading;
  // Books already in the library show in the library group.
  const results = (search.data?.results ?? []).filter((b) => !b.in_library);
  if (!waiting && !search.isError && results.length === 0) return null;

  return (
    <Group title={t("find.groups.books")}>
      {waiting ? (
        <p className="text-sm text-neutral-400">{t("find.searchingBooks")}</p>
      ) : search.isError ? (
        <p role="alert" className="text-sm text-amber-300">
          {t("books.add.searchFailed")}
        </p>
      ) : (
        <ul className="space-y-2">
          {results.map((book) => (
            <BookRow
              key={book.google_volume_id}
              book={book}
              isAdmin={me?.is_admin === true}
              onAdd={() => setAdding(true)}
            />
          ))}
        </ul>
      )}
      {adding && (
        <AddBookDialog initialQuery={query} onClose={() => setAdding(false)} />
      )}
    </Group>
  );
}

/** One query, three groups: your library, TMDB titles, then books. */
export function FindResults({ query }: { query: string }) {
  const { data: features } = useFeatures();
  return (
    <div className="space-y-8">
      <LibraryGroup query={query} />
      <TitlesGroup query={query} />
      {features?.books_enabled && <BooksGroup query={query} />}
    </div>
  );
}
