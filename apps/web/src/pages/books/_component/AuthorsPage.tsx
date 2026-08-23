import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { BookOpen, Check, Headphones, Library, UserRound } from "lucide-react";
import type { Author, BookEditionKind } from "@rawkoon/shared/types";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { Switch } from "@/components/ui/switch";
import { MultiSelect } from "@/pages/settings/_component/QualityProfileMultiSelect";
import { SEARCH_TITLE_LANGUAGE_OPTIONS } from "@/pages/settings/_component/QualityProfileForm";
import { useAuthors, useUpdateAuthor } from "../_hooks/useBooks";

const KINDS: BookEditionKind[] = ["ebook", "audiobook"];

const formatDate = (iso: string | null, fallback: string): string =>
  iso ? new Date(iso).toLocaleDateString() : fallback;

/**
 * Initials, because there is never a portrait.
 *
 * Google Books exposes no author image, so `image_url` is null for every row
 * this page will ever render — the generic person glyph was permanent, not a
 * placeholder. Initials in the display serif at least identify the author.
 */
function AuthorMark({ name, monitored }: { name: string; monitored: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-sm ring-1 ${
        monitored
          ? "bg-primary-500/15 text-primary-200 ring-primary-500/30"
          : "bg-neutral-800 text-neutral-400 ring-neutral-700"
      }`}
    >
      {initials || <UserRound className="h-4 w-4" />}
    </span>
  );
}

/**
 * One author. Monitoring is the only thing editable here: a row exists because
 * a book credited them, so there is nothing to create or delete.
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
    <div className="flex overflow-hidden rounded-lg border border-neutral-800 bg-surface-raised/40">
      {/* The same rail as a book row: copper when this author is followed,
          inert when they are not. */}
      <span
        aria-hidden
        className={`w-1 shrink-0 ${
          author.monitored ? "bg-primary-500" : "bg-neutral-700"
        }`}
      />

      <div className="min-w-0 flex-1 p-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <AuthorMark name={author.name} monitored={author.monitored} />

          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base text-neutral-50">
              {author.name}
            </p>
            <p className="mt-0.5 text-sm text-neutral-400">
              {t("books.authors.bookCount", { count: author.book_count })}
            </p>
          </div>

          {/* Dates are data: mono face, fixed columns, so rows line up whether
              or not an author has ever been checked. */}
          {author.monitored && (
            <dl className="flex shrink-0 gap-5 text-xs sm:w-[200px]">
              <div>
                <dt className="text-neutral-500">
                  {t("books.authors.fromLabel")}
                </dt>
                <dd className="mt-0.5 font-mono text-[11px] text-neutral-300">
                  {formatDate(author.monitor_from, t("books.authors.never"))}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">
                  {t("books.authors.checkedLabel")}
                </dt>
                <dd className="mt-0.5 font-mono text-[11px] text-neutral-300">
                  {formatDate(
                    author.last_checked_at,
                    t("books.authors.neverChecked"),
                  )}
                </dd>
              </div>
            </dl>
          )}

          {/* Which editions new titles arrive as. Pressed toggles rather than
              status-looking chips: they change something when clicked, and a
              badge gives no hint of that. */}
          {author.monitored && (
            <div
              className="flex shrink-0 gap-1.5"
              role="group"
              aria-label={t("books.authors.kindsLabel")}
            >
              {KINDS.map((kind) => {
                const on = author.monitor_edition_kinds.includes(kind);
                const Icon = kind === "audiobook" ? Headphones : BookOpen;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={busy}
                    aria-pressed={on}
                    onClick={() => toggleKind(kind)}
                    className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      on
                        ? "border-primary-500/40 bg-primary-500/15 text-primary-200"
                        : "border-neutral-700 bg-transparent text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {on ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Icon className="h-3 w-3" />
                    )}
                    {t(
                      `books.kind${kind === "audiobook" ? "Audiobook" : "Ebook"}`,
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Which language a new title has to be in. A book is one language,
              not one edition per language, so following an author without this
              collected every translation of every title. Empty means any. */}
          {author.monitored && (
            <div className="shrink-0 sm:w-[190px]">
              <MultiSelect
                label={t("books.authors.languagesLabel")}
                placeholder={t("books.authors.anyLanguage")}
                options={SEARCH_TITLE_LANGUAGE_OPTIONS}
                selected={author.monitor_languages}
                onChange={(next) =>
                  update.mutate({ id: author.id, monitor_languages: next })
                }
              />
            </div>
          )}

          {/* Label before the switch, in the row's flow. It used to be
              positioned under the switch, where it hung over the card edge. */}
          <label className="flex shrink-0 items-center gap-2 sm:w-[120px] sm:justify-end">
            <span className="text-xs text-neutral-400">
              {author.monitored
                ? t("books.authors.monitored")
                : t("books.authors.off")}
            </span>
            <Switch
              checked={author.monitored}
              disabled={busy}
              aria-label={t("books.authors.monitorToggle", {
                name: author.name,
              })}
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
          </label>
        </div>

        {update.isError && (
          <p className="mt-2 text-xs text-rose-300">
            {t("books.authors.saveFailed")}
          </p>
        )}
      </div>
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
          <Link
            to="/books"
            className="focus-ring inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
          >
            <Library className="h-4 w-4" />
            {t("books.authors.booksLink")}
          </Link>
        }
      />

      {/* Held to a reading measure. It ran the full page width before, about
          twice as long a line as prose can be read at. */}
      <p className="mb-5 max-w-[68ch] text-sm text-neutral-400">
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
