import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Headphones, Loader2, Plus, Search, X } from "lucide-react";
import type { BookEditionKind } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import { useAddBook, useBookProviderSearch } from "../_hooks/useBooks";

/**
 * Add a book by searching Google Books.
 *
 * Search runs only on submit, never per keystroke: Google Books is
 * rate-limited and returns intermittent 503s, so typing-triggered queries
 * would both waste quota and surface spurious failures.
 */
export function AddBookDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("common");
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [kinds, setKinds] = useState<BookEditionKind[]>(["ebook"]);

  const { data, isFetching, error } = useBookProviderSearch(
    submitted,
    submitted.length > 1,
  );
  const addBook = useAddBook();

  const toggleKind = (kind: BookEditionKind) => {
    setKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  const searchError =
    error instanceof ApiError
      ? error.message
      : error
        ? t("books.add.searchFailed")
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16">
      <div className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 className="text-lg font-semibold text-neutral-100">
            {t("books.add.title")}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t("books.add.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form
          className="flex gap-2 px-5 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(input.trim());
          }}
        >
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("books.add.queryPlaceholder")}
            className="flex-1"
          />
          <Button type="submit" disabled={input.trim().length < 2}>
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>

        <div className="flex items-center gap-2 px-5 pt-3 text-xs text-neutral-400">
          <span>{t("books.add.addAs")}</span>
          {(["ebook", "audiobook"] as BookEditionKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors ${
                kinds.includes(kind)
                  ? "bg-primary-500/15 text-primary-300"
                  : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {kind === "audiobook" ? (
                <Headphones className="h-3 w-3" />
              ) : (
                <BookOpen className="h-3 w-3" />
              )}
              {t(`books.kind${kind === "audiobook" ? "Audiobook" : "Ebook"}`)}
            </button>
          ))}
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
          {searchError && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {searchError}
            </p>
          )}

          {!searchError &&
            submitted &&
            !isFetching &&
            data?.results.length === 0 && (
              <p className="py-6 text-center text-sm text-neutral-500">
                {t("books.add.nothingFound", { query: submitted })}
              </p>
            )}

          <ul className="space-y-2">
            {data?.results.map((r) => (
              <li
                key={r.google_volume_id}
                className="flex items-start gap-3 rounded-lg border border-neutral-800 p-3"
              >
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-neutral-950">
                  {r.cover_url ? (
                    <img
                      src={r.cover_url}
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
                  <p className="truncate font-medium text-neutral-100">
                    {r.title}
                  </p>
                  <p className="truncate text-sm text-neutral-400">
                    {r.authors.join(", ") || t("books.unknownAuthor")}
                    {r.published_year ? ` · ${r.published_year}` : ""}
                    {` · ${r.language.toUpperCase()}`}
                  </p>
                  {r.isbn13 && (
                    <p className="mt-0.5 font-mono text-xs text-neutral-600">
                      {r.isbn13}
                    </p>
                  )}
                </div>

                {r.in_library ? (
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">
                    {t("books.add.inLibrary")}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    disabled={kinds.length === 0 || addBook.isPending}
                    onClick={() =>
                      addBook.mutate(
                        { google_volume_id: r.google_volume_id, kinds },
                        { onSuccess: onClose },
                      )
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("books.add.addAction")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
