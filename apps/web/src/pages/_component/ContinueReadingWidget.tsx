import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Check, Headphones, Library } from "lucide-react";
import { WidgetShell, WidgetHeader } from "@/pages/_component/widgetPrimitives";
import { useContinueReading } from "@/pages/_component/useContinueReading";
import { useEndReading } from "@/features/books/useBookReading";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { formatClock } from "@/features/player/formatClock";
import type { BookReadingEntry } from "@rawkoon/shared/types";

/**
 * "Continue reading" — the books with a saved position, so getting back into
 * one costs a tap instead of a trip through the library.
 *
 * Hidden entirely when nothing is started: an empty shelf on the dashboard is
 * noise for anyone not using the reader at all.
 */
export function ContinueReadingWidget() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { data } = useContinueReading();

  const entries = data?.reading ?? [];
  if (entries.length === 0) return null;

  return (
    <WidgetShell>
      <WidgetHeader
        icon={Library}
        title={t("dashboard.home.continueReading")}
      />
      <div className="divide-y divide-neutral-800/60">
        {entries.map((entry) => (
          <Row
            key={entry.edition_id}
            entry={entry}
            // Both destinations resume where the position left off: the reader
            // opens at the stored locator, the player seeks to the second.
            onOpen={() =>
              navigate({
                to:
                  entry.kind === "audiobook"
                    ? "/books/$bookId/listen"
                    : "/books/$bookId/read",
                params: { bookId: String(entry.book_id) },
              })
            }
          />
        ))}
      </div>
    </WidgetShell>
  );
}

/**
 * One book, and the way off the list.
 *
 * The row is not one big button: "Finished" sits inside it, and a button inside
 * a button is markup a browser resolves by dropping one of them.
 */
function Row({
  entry,
  onOpen,
}: {
  entry: BookReadingEntry;
  onOpen: () => void;
}) {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const endReading = useEndReading(entry.edition_id);
  const percent = percentOf(entry);

  return (
    <div className="group flex items-center gap-1 pr-2 hover:bg-neutral-800/40">
      <button
        type="button"
        onClick={onOpen}
        className="focus-ring flex min-w-0 flex-1 gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-16 w-[3rem] shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-800">
          {entry.cover_url ? (
            <img
              decoding="async"
              src={entry.cover_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : entry.kind === "audiobook" ? (
            <Headphones className="h-5 w-5 text-neutral-500" aria-hidden />
          ) : (
            <BookOpen className="h-5 w-5 text-neutral-500" aria-hidden />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-neutral-100">
            {entry.title}
          </span>
          <span className="block truncate text-xs text-neutral-500">
            {entry.authors.length > 0
              ? entry.authors.join(", ")
              : t(
                  entry.kind === "audiobook"
                    ? "books.kindAudiobook"
                    : "books.kindEbook",
                )}
          </span>
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-800">
              <span
                className="block h-full rounded-full bg-primary-500"
                style={{ width: `${percent}%` }}
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </span>
            <span className="shrink-0 font-mono text-[11px] text-neutral-500">
              {positionLabel(entry)}
            </span>
          </span>
        </span>
      </button>

      {/* Finished, not reset: leaving the list is not the same as forgetting
          the page, and from a dashboard it is nearly always the former.
          Restarting a book lives on the book's own page. */}
      <button
        type="button"
        onClick={() =>
          confirm({
            title: t("books.open.finishTitle", { title: entry.title }),
            description: t("books.open.finishDescription"),
            confirmLabel: t("books.open.finish"),
            onConfirm: async () => {
              await endReading.mutateAsync({
                mode: "finish",
                locator: entry.locator,
                position_secs: entry.position_secs,
                file_id: entry.file_id,
              });
            },
          })
        }
        disabled={endReading.isPending}
        aria-label={t("books.open.finish")}
        title={t("books.open.finish")}
        className="focus-ring shrink-0 rounded-md p-2 text-neutral-500 opacity-0 hover:text-neutral-200 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * How far along the bar sits. An audiobook has no percent of its own — a
 * position over a known total is one, and an unknown total leaves the bar empty
 * rather than guessing.
 */
const percentOf = (entry: BookReadingEntry): number => {
  const fraction =
    entry.kind === "audiobook"
      ? entry.total_duration_secs
        ? (entry.position_secs ?? 0) / entry.total_duration_secs
        : 0
      : (entry.percent ?? 0);
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
};

/** A clock for a listener, a percentage for a reader. */
const positionLabel = (entry: BookReadingEntry): string =>
  entry.kind === "audiobook"
    ? formatClock(entry.position_secs ?? 0)
    : `${percentOf(entry)}%`;
