import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Headphones, Library } from "lucide-react";
import { WidgetShell, WidgetHeader } from "@/pages/_component/widgetPrimitives";
import { useContinueReading } from "@/pages/_component/useContinueReading";
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
          <button
            key={entry.edition_id}
            type="button"
            // Both destinations resume where the position left off: the reader
            // opens at the stored locator, the player seeks to the second.
            onClick={() =>
              navigate({
                to:
                  entry.kind === "audiobook"
                    ? "/books/$bookId/listen"
                    : "/books/$bookId/read",
                params: { bookId: String(entry.book_id) },
              })
            }
            className="focus-ring flex w-full gap-3 px-4 py-3 text-left hover:bg-neutral-800/40"
          >
            <div className="flex h-16 w-[3rem] shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-800">
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
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-100">
                {entry.title}
              </p>
              <p className="truncate text-xs text-neutral-500">
                {entry.authors.length > 0
                  ? entry.authors.join(", ")
                  : t(
                      entry.kind === "audiobook"
                        ? "books.kindAudiobook"
                        : "books.kindEbook",
                    )}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-primary-500"
                    style={{ width: `${percentOf(entry)}%` }}
                    role="progressbar"
                    aria-valuenow={percentOf(entry)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <span className="shrink-0 font-mono text-[11px] text-neutral-500">
                  {positionLabel(entry)}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </WidgetShell>
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
