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
import type { Book, BookEditionKind } from "@rawkoon/shared/types";
import { useLibraryEvents } from "@/features/medias/hooks/useLibraryEvents";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBooks } from "../_hooks/useBooks";
import { editionChipLabel } from "./editionLabel";
import { AddBookDialog } from "./AddBookDialog";

const STATUS_STYLES: Record<string, string> = {
  wanted: "bg-amber-500/15 text-amber-400",
  downloading: "bg-sky-500/15 text-sky-400",
  downloaded: "bg-emerald-500/15 text-emerald-400",
  upgrading: "bg-primary-500/15 text-primary-300",
  skipped: "bg-neutral-700/40 text-neutral-400",
};

function EditionChip({
  kind,
  status,
  format,
}: {
  kind: BookEditionKind;
  status: string;
  format: string | null;
}) {
  const { t } = useTranslation("common");
  const Icon = kind === "audiobook" ? Headphones : BookOpen;
  // An unknown status must still read as something, so the raw value is the
  // fallback rather than an empty chip.
  const statusLabel = t(`books.status.${status}`, { defaultValue: status });
  const kindLabel = t(
    `books.kind${kind === "audiobook" ? "Audiobook" : "Ebook"}`,
  );
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.skipped
      }`}
      title={
        format
          ? t("books.editionChipTitleWithFormat", {
              kind: kindLabel,
              status: statusLabel,
              format,
            })
          : t("books.editionChipTitle", {
              kind: kindLabel,
              status: statusLabel,
            })
      }
    >
      <Icon className="h-3 w-3" />
      {editionChipLabel(statusLabel, format)}
    </span>
  );
}

function BookRow({ book }: { book: Book }) {
  const { t } = useTranslation("common");
  return (
    <Link
      to="/books/$bookId"
      params={{ bookId: String(book.id) }}
      className="flex items-start gap-3 rounded-lg border border-neutral-800 p-3 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
    >
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded bg-neutral-950 ring-1 ring-primary-500/20">
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <BookOpen className="h-5 w-5 text-neutral-700" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-neutral-100">{book.title}</p>
        <p className="truncate text-sm text-neutral-400">
          {book.authors.join(", ") || t("books.unknownAuthor")}
          {book.published_year ? ` · ${book.published_year}` : ""}
          {` · ${book.language.toUpperCase()}`}
        </p>
        {book.series_name && (
          <p className="truncate text-xs text-neutral-500">
            {book.series_position != null
              ? t("books.seriesPosition", {
                  series: book.series_name,
                  position: book.series_position,
                })
              : book.series_name}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {book.editions.map((e) => (
            <EditionChip
              key={e.id}
              kind={e.kind}
              status={e.status}
              format={e.best_format}
            />
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
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link to="/books/authors">
                <UserRound className="mr-1.5 h-4 w-4" />
                {t("books.authorsLink")}
              </Link>
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("books.addBook")}
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(search.trim());
          }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("books.filterPlaceholder")}
            className="max-w-xs"
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
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                kind === k
                  ? "bg-primary-500/15 text-primary-300"
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
