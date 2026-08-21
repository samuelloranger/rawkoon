import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  List,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChapterRail } from "@/features/books/ChapterRail";
import { usePlayer } from "./PlayerProvider";
import { formatClock, formatRemaining } from "./formatClock";
import { MAX_RATE, MIN_RATE } from "./AudiobookEngine";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/**
 * The full player. Same state as the bar, same rail — the difference is room:
 * the cover at size, the chapter list, rate and boost.
 */
export const PlayerExpanded = () => {
  const { engine, state, expanded, setExpanded } = usePlayer();
  const { t } = useTranslation("common");
  const [showChapters, setShowChapters] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === " ") {
        event.preventDefault();
        void engine.toggle();
      } else if (event.key === "ArrowLeft") engine.skip(-15);
      else if (event.key === "ArrowRight") engine.skip(30);
      else if (event.key === "Escape") setExpanded(false);
      else if (event.key === "[") engine.setRate(state.rate - 0.25);
      else if (event.key === "]") engine.setRate(state.rate + 0.25);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, expanded, setExpanded, state.rate]);

  if (state.editionId == null || !expanded) return null;

  const chapter = state.chapters[state.chapterIndex];

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-surface-base"
      // Same reason as the reader: a full-screen surface in a PWA has to inset
      // itself past the status bar and the home indicator.
      style={{
        paddingTop: "var(--safe-top)",
        paddingBottom: "var(--safe-bottom)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="focus-ring rounded-md p-2 text-text-muted hover:text-text-strong"
          aria-label={t("books.player.collapse")}
        >
          <ChevronDown className="size-5" />
        </button>
        <span className="text-xs uppercase tracking-widest text-text-muted">
          {t("books.player.listening")}
        </span>
        <button
          type="button"
          onClick={() => setShowChapters((open) => !open)}
          className={cn(
            "focus-ring rounded-md p-2 hover:text-text-strong",
            showChapters ? "text-primary-400" : "text-text-muted",
          )}
          aria-label={t("books.player.chapters")}
          aria-pressed={showChapters}
        >
          <List className="size-5" />
        </button>
      </div>

      {showChapters ? (
        <ul className="flex-1 overflow-y-auto px-4 pb-8">
          {state.chapters.map((entry) => (
            <li key={entry.index}>
              <button
                type="button"
                onClick={() => {
                  engine.seekChapter(entry.index);
                  setShowChapters(false);
                }}
                className={cn(
                  "focus-ring flex w-full items-baseline justify-between gap-4 rounded-md px-2 py-3 text-left",
                  entry.index === state.chapterIndex
                    ? "text-primary-400"
                    : "text-text hover:text-text-strong",
                )}
              >
                <span className="truncate">
                  {entry.label ??
                    t("books.player.chapterN", { n: entry.index + 1 })}
                </span>
                <span className="shrink-0 font-mono text-xs text-text-muted">
                  {formatClock(entry.start)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 pb-10">
          <div className="mx-auto w-48">
            {state.coverUrl ? (
              <img
                src={state.coverUrl}
                alt=""
                className="w-full rounded-lg border border-border object-cover shadow-lg"
              />
            ) : (
              <div className="aspect-[2/3] w-full rounded-lg border border-border bg-surface-raised" />
            )}
          </div>

          <div className="text-center">
            <h1 className="font-display text-2xl text-text-strong">
              {state.title}
            </h1>
            <p className="mt-1 text-sm text-text">{state.authors.join(", ")}</p>
            {state.narrators.length > 0 && (
              <p className="mt-0.5 text-xs text-text-muted">
                {t("books.player.readBy", {
                  names: state.narrators.join(", "),
                })}
              </p>
            )}
          </div>

          <div>
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
            <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-text-muted">
              <span>{formatClock(state.position)}</span>
              <span className="truncate px-2 font-sans">
                {chapter?.label ?? ""}
              </span>
              <span>{formatRemaining(state.position, state.duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={() => engine.skip(-15)}
              className="focus-ring rounded-md p-2 text-text hover:text-text-strong"
              aria-label={t("books.player.back15")}
            >
              <RotateCcw className="size-6" />
            </button>
            <button
              type="button"
              onClick={() => void engine.toggle()}
              className="focus-ring rounded-full bg-primary-600 p-4 text-neutral-50 hover:bg-primary-500"
              aria-label={
                state.playing ? t("books.player.pause") : t("books.player.play")
              }
            >
              {state.playing ? (
                <Pause className="size-7" />
              ) : (
                <Play className="size-7" />
              )}
            </button>
            <button
              type="button"
              onClick={() => engine.skip(30)}
              className="focus-ring rounded-md p-2 text-text hover:text-text-strong"
              aria-label={t("books.player.forward30")}
            >
              <RotateCw className="size-6" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-xs text-text-muted">
              {t("books.player.speed")}
              <select
                value={state.rate}
                onChange={(event) => engine.setRate(Number(event.target.value))}
                className="focus-ring rounded-md border border-border bg-surface-raised px-2 py-1 font-mono text-xs text-text"
              >
                {RATES.filter((r) => r >= MIN_RATE && r <= MAX_RATE).map(
                  (r) => (
                    <option key={r} value={r}>
                      {r}x
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="flex items-center gap-2 text-xs text-text-muted">
              <Volume2 className="size-4" />
              <span className="sr-only">{t("books.player.boost")}</span>
              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={state.boostDb}
                onChange={(event) =>
                  engine.setBoostDb(Number(event.target.value))
                }
                className="focus-ring w-24 accent-primary-600"
                aria-label={t("books.player.boost")}
              />
              <span className="w-10 font-mono">+{state.boostDb}dB</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
