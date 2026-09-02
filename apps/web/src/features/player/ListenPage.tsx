import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { BookCover } from "@/pages/books/_component/BookCover";
import { useBook } from "@/pages/books/_hooks/useBooks";
import { formatClock } from "./formatClock";
import { PLAYBACK_RATES, usePlayer, type PlaybackRate } from "./PlayerProvider";

export function ListenPage({ bookId }: { bookId: number }) {
  const { t } = useTranslation("common");
  const { data, isLoading } = useBook(bookId);
  const player = usePlayer();
  const book = data?.item;
  const edition = book?.editions.find((e) => e.kind === "audiobook");

  useEffect(() => {
    if (!edition?.offline_ready) return;
    if (player.editionId === edition.id) return;
    void player.load(edition.id, bookId);
  }, [
    bookId,
    edition?.id,
    edition?.offline_ready,
    player.editionId,
    player.load,
  ]);

  if (isLoading) {
    return (
      <PageLayout>
        <p className="py-16 text-center text-sm text-neutral-500">
          {t("books.listen.loading")}
        </p>
      </PageLayout>
    );
  }

  if (!book) {
    return (
      <PageLayout>
        <p className="py-16 text-center text-sm text-neutral-500">
          {t("books.detail.notFound")}
        </p>
      </PageLayout>
    );
  }

  if (!edition?.offline_ready) {
    return (
      <PageLayout>
        <BackLink bookId={bookId} />
        <p className="py-16 text-center text-sm text-neutral-400">
          {t("books.listen.notReady")}
        </p>
      </PageLayout>
    );
  }

  const errorCopy =
    player.error === "chapter" || player.error === "play"
      ? t("books.player.error")
      : player.error
        ? t("books.player.error")
        : null;

  return (
    <PageLayout>
      <BackLink bookId={bookId} />
      <div className="mx-auto flex max-w-lg flex-col items-center gap-6">
        <BookCover
          title={book.title}
          author={book.authors[0] ?? null}
          coverUrl={book.cover_url}
          size="hero"
          alt={t("books.detail.coverAlt", { title: book.title })}
        />
        <div className="w-full text-center">
          <h1 className="font-display text-2xl text-neutral-50 sm:text-3xl">
            {book.title}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {book.authors.join(", ")}
          </p>
        </div>

        {errorCopy && (
          <p className="text-center text-sm text-red-400" role="alert">
            {errorCopy}
          </p>
        )}

        <div className="w-full">
          <input
            type="range"
            min={0}
            max={Math.max(player.durationSecs, 0)}
            step={1}
            value={Math.min(player.positionSecs, player.durationSecs)}
            aria-label={t("books.listen.title")}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-primary-500"
            onChange={(e) => player.seek(Number(e.target.value))}
          />
          <div className="mt-1 flex justify-between font-mono text-[11px] text-neutral-500">
            <span>{formatClock(player.positionSecs)}</span>
            <span>{formatClock(player.durationSecs)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("books.player.prevChapter")}
            onClick={() => player.prevChapter()}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("books.player.skipBack")}
            onClick={() => player.skip(-30)}
          >
            <SkipBack className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="lg"
            aria-label={
              player.isPlaying
                ? t("books.player.pause")
                : t("books.player.play")
            }
            onClick={() => (player.isPlaying ? player.pause() : player.play())}
          >
            {player.isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("books.player.skipForward")}
            onClick={() => player.skip(30)}
          >
            <SkipForward className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("books.player.nextChapter")}
            onClick={() => player.nextChapter()}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-400">
          {t("books.player.rate")}
          <select
            className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
            value={player.rate}
            onChange={(e) =>
              player.setRate(Number(e.target.value) as PlaybackRate)
            }
          >
            {PLAYBACK_RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>

        <section className="w-full">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            {t("books.listen.chapters")}
          </h2>
          <ol className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
            {player.chapters.map((chapter) => {
              const active = chapter.index === player.currentChapterIndex;
              return (
                <li key={chapter.index}>
                  <button
                    type="button"
                    className={`focus-ring flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left text-sm ${
                      active
                        ? "bg-neutral-800/80 text-neutral-50"
                        : "text-neutral-300 hover:bg-neutral-900"
                    }`}
                    onClick={() => player.seek(chapter.start_secs)}
                  >
                    <span className="min-w-0 truncate">{chapter.title}</span>
                    <span className="shrink-0 font-mono text-[11px] text-neutral-500">
                      {formatClock(chapter.start_secs)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </PageLayout>
  );
}

function BackLink({ bookId }: { bookId: number }) {
  const { t } = useTranslation("common");
  return (
    <Link
      to="/books/$bookId"
      params={{ bookId: String(bookId) }}
      className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-neutral-400 transition-colors hover:text-neutral-100"
    >
      <ArrowLeft className="h-4 w-4" />
      {t("books.listen.back")}
    </Link>
  );
}
