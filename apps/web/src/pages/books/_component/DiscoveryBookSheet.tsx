import { BookOpen, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import type { BookDiscoveryBook } from "@rawkoon/shared/types";
import { providerHtmlParagraphs } from "@rawkoon/shared";
import { Button } from "@/components/ui/button";
import { useAddBook } from "../_hooks/useBooks";

/** External-link label from the product URL's host. */
function sourceLabel(url: string, fallback: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return fallback;
  }
}

/**
 * Read-only detail for a not-in-library bestseller: cover, synopsis, external
 * buy link, and — once enriched (a `volumeId` is present) — an add-to-library
 * action. Books already owned show a link into their library detail instead.
 */
export function DiscoveryBookSheet({
  book,
  onClose,
}: {
  book: BookDiscoveryBook;
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const addBook = useAddBook();
  const paragraphs = providerHtmlParagraphs(book.overview);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 className="line-clamp-1 text-lg font-semibold text-neutral-100">
            {book.title}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t("books.explore.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-4 px-5 py-4">
          <div className="h-40 w-28 shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-neutral-700">
                <BookOpen className="h-7 w-7" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            {book.author && (
              <p className="text-sm text-neutral-300">{book.author}</p>
            )}
            {book.publishedYear && (
              <p className="text-xs text-neutral-500">{book.publishedYear}</p>
            )}
            <p className="mt-1 text-xs text-neutral-500">#{book.rank}</p>
          </div>
        </div>

        {paragraphs.length > 0 && (
          <div className="space-y-2 px-5 pb-4 text-sm text-neutral-300">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 px-5 py-4">
          {book.alreadyInLibrary ? (
            <Link
              to="/books"
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 hover:bg-neutral-700"
            >
              {t("books.explore.inLibrary")}
            </Link>
          ) : book.volumeId ? (
            <Button
              disabled={addBook.isPending || addBook.isSuccess}
              onClick={() =>
                addBook.mutate({
                  google_volume_id: book.volumeId as string,
                  isbn13: book.isbn13,
                  kinds: ["ebook"],
                })
              }
            >
              {addBook.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              {addBook.isSuccess
                ? t("books.explore.added")
                : t("books.explore.add")}
            </Button>
          ) : null}

          {book.sourceUrl && (
            <a
              href={book.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-neutral-400 hover:text-neutral-100"
            >
              <ExternalLink className="h-4 w-4" />
              {sourceLabel(book.sourceUrl, t("books.explore.viewSource"))}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
