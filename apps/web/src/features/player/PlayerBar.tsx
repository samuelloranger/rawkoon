import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ChevronUp, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { ChapterRail } from "@/features/books/ChapterRail";
import { usePlayer } from "./PlayerProvider";
import { formatClock, formatRemaining } from "./formatClock";

/**
 * The compact player: present on every route once something is loaded, absent
 * otherwise. There is no empty state to design because there is no empty bar.
 */
export const PlayerBar = () => {
  const { engine, state, expanded, setExpanded, close } = usePlayer();
  const { t } = useTranslation("common");

  if (state.editionId == null || expanded) return null;

  const chapter = state.chapters[state.chapterIndex];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-border bg-surface-raised/95 backdrop-blur lg:left-60"
      // Clear of the home indicator when installed to the home screen.
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-3 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
            aria-label={t("books.player.expand")}
          >
            {state.coverUrl ? (
              <img
                src={state.coverUrl}
                alt=""
                className="h-9 w-6 shrink-0 rounded-sm object-cover"
              />
            ) : (
              <span className="h-9 w-6 shrink-0 rounded-sm bg-neutral-800" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm text-text-strong">
                {state.title}
              </span>
              <span className="block truncate text-xs text-text-muted">
                {chapter?.label ?? state.narrators[0] ?? state.authors[0]}
              </span>
            </span>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => engine.skip(-15)}
              className="focus-ring rounded-md p-2 text-text-muted hover:text-text-strong"
              aria-label={t("books.player.back15")}
            >
              <RotateCcw className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void engine.toggle()}
              className="focus-ring rounded-full bg-primary-600 p-2 text-neutral-50 hover:bg-primary-500"
              aria-label={
                state.playing ? t("books.player.pause") : t("books.player.play")
              }
            >
              {state.playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => engine.skip(30)}
              className="focus-ring rounded-md p-2 text-text-muted hover:text-text-strong"
              aria-label={t("books.player.forward30")}
            >
              <RotateCw className="size-4" />
            </button>
          </div>

          <span className="hidden font-mono text-xs text-text-muted sm:block">
            {formatClock(state.position)}
          </span>

          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="focus-ring rounded-md p-2 text-text-muted hover:text-text-strong"
            aria-label={t("books.player.expand")}
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={close}
            className="focus-ring rounded-md p-2 text-text-muted hover:text-text-strong"
            aria-label={t("books.player.close")}
          >
            <X className="size-4" />
          </button>
        </div>

        <ChapterRail
          segments={state.chapters.map((c) => ({
            start: c.start,
            end: c.end,
            label: c.label,
          }))}
          position={state.position}
          total={state.duration}
          buffered={state.buffered}
          onSeek={engine.seekAbsolute}
          formatPosition={formatClock}
          ariaLabel={t("books.player.position")}
        />

        {state.bookId != null && (
          <Link
            to="/books/$bookId"
            params={{ bookId: String(state.bookId) }}
            className="sr-only focus:not-sr-only"
          >
            {t("books.player.openBook")}
          </Link>
        )}
        <span className="sr-only">
          {formatRemaining(state.position, state.duration)}
        </span>
      </div>
    </div>
  );
};
