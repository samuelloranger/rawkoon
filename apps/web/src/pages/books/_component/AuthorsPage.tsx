import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { BookOpen, Headphones, Library, UserRound } from "lucide-react";
import type { Author, BookEditionKind } from "@rawkoon/shared/types";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuthors, useUpdateAuthor } from "../_hooks/useBooks";

const KINDS: BookEditionKind[] = ["ebook", "audiobook"];

const formatDate = (iso: string | null, fallback: string): string =>
  iso ? new Date(iso).toLocaleDateString() : fallback;

/**
 * One author. Monitoring is the only thing editable here: an author row exists
 * because a book credited them, so there is nothing to create or delete.
 */
function AuthorRow({ author }: { author: Author }) {
  const { t } = useTranslation("common");
  const update = useUpdateAuthor();
  const busy = update.isPending;

  const toggleKind = (kind: BookEditionKind) => {
    const next = author.monitor_edition_kinds.includes(kind)
      ? author.monitor_edition_kinds.filter((k) => k !== kind)
      : [...author.monitor_edition_kinds, kind];
    update.mutate({ id: author.id, monitor_edition_kinds: next });
  };

  return (
    <div className="rounded-lg border border-neutral-800 p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 ring-1 ring-neutral-800">
          <UserRound className="h-4 w-4 text-neutral-500" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-neutral-100">{author.name}</p>
          <p className="text-sm text-neutral-400">
            {t("books.authors.bookCount", { count: author.book_count })}
            {author.monitored && (
              <>
                {" · "}
                <span className="font-mono text-xs">
                  {t("books.authors.from", {
                    date: formatDate(
                      author.monitor_from,
                      t("books.authors.never"),
                    ),
                  })}
                </span>
                {" · "}
                <span className="font-mono text-xs">
                  {t("books.authors.checked", {
                    date: formatDate(
                      author.last_checked_at,
                      t("books.authors.never"),
                    ),
                  })}
                </span>
              </>
            )}
          </p>

          {author.monitored && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {KINDS.map((kind) => {
                const on = author.monitor_edition_kinds.includes(kind);
                const Icon = kind === "audiobook" ? Headphones : BookOpen;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleKind(kind)}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      on
                        ? "bg-primary-500/15 text-primary-300"
                        : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {t(
                      `books.kind${kind === "audiobook" ? "Audiobook" : "Ebook"}`,
                    )}
                  </button>
                );
              })}
              {author.monitor_edition_kinds.length === 0 && (
                // Monitoring with no kind selected adds ebooks, which is what
                // the worker falls back to. Say so rather than look broken.
                <span className="text-xs text-amber-400">
                  {t("books.authors.noKindSelected")}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <Switch
            checked={author.monitored}
            disabled={busy}
            onCheckedChange={(checked) =>
              update.mutate({
                id: author.id,
                monitored: checked,
                // Turning it on with no kinds set would silently do nothing
                // useful, so seed the common case.
                ...(checked && author.monitor_edition_kinds.length === 0
                  ? { monitor_edition_kinds: ["ebook" as BookEditionKind] }
                  : {}),
              })
            }
          />
          <span className="text-xs text-neutral-500">
            {author.monitored
              ? t("books.authors.monitored")
              : t("books.authors.off")}
          </span>
        </div>
      </div>

      {update.isError && (
        <p className="mt-2 text-xs text-rose-300">
          {t("books.authors.saveFailed")}
        </p>
      )}
    </div>
  );
}

export function AuthorsPage() {
  const { t } = useTranslation("common");
  const { data, isLoading, refetch, isRefetching } = useAuthors();
  const authors = data?.authors ?? [];
  const monitoredCount = authors.filter((a) => a.monitored).length;

  return (
    <PageLayout>
      <PageHeader
        icon={UserRound}
        title={t("books.authors.title")}
        subtitle={
          data
            ? t("books.authors.subtitleCount", {
                monitored: monitoredCount,
                total: authors.length,
              })
            : t("books.authors.subtitleEmpty")
        }
        onRefresh={() => void refetch()}
        isRefreshing={isRefetching}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/books">
              <Library className="mr-1.5 h-4 w-4" />
              {t("books.authors.booksLink")}
            </Link>
          </Button>
        }
      />

      <p className="mb-4 text-sm text-neutral-400">
        {t("books.authors.explanation")}
      </p>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          {t("books.authors.loading")}
        </p>
      ) : authors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-800 py-16 text-center">
          <UserRound className="mx-auto h-8 w-8 text-neutral-700" />
          <p className="mt-3 text-sm text-neutral-400">
            {t("books.authors.none")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {authors.map((a) => (
            <li key={a.id}>
              <AuthorRow author={a} />
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}
