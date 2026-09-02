import { Link, useRouterState } from "@tanstack/react-router";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BookCover } from "@/pages/books/_component/BookCover";
import { Button } from "@/components/ui/button";
import { formatClock } from "./formatClock";
import { usePlayer } from "./PlayerProvider";

export function MiniPlayer() {
  const { t } = useTranslation("common");
  const player = usePlayer();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onLogin = pathname === "/login";
  const onListen = /\/books\/[^/]+\/listen\/?$/.test(pathname);

  if (!player.loaded || onLogin || onListen) return null;

  const bookId = String(player.bookId ?? "");

  return (
    <div className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-neutral-800 bg-neutral-950/95 px-3 py-2 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <Link
          to="/books/$bookId/listen"
          params={{ bookId }}
          className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md"
        >
          <BookCover
            title={player.title ?? ""}
            author={player.authors[0] ?? null}
            coverUrl={player.coverUrl}
            size="row"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-sm text-neutral-50">
              {player.title}
            </p>
            <p className="truncate text-xs text-neutral-400">
              {player.authors.join(", ")}
            </p>
            <p className="font-mono text-[11px] text-neutral-500">
              {formatClock(player.positionSecs)} /{" "}
              {formatClock(player.durationSecs)}
            </p>
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("books.player.skipBack")}
            onClick={() => player.skip(-30)}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={
              player.isPlaying
                ? t("books.player.pause")
                : t("books.player.play")
            }
            onClick={() => (player.isPlaying ? player.pause() : player.play())}
          >
            {player.isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("books.player.skipForward")}
            onClick={() => player.skip(30)}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("books.player.close")}
            onClick={() => player.unload()}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
