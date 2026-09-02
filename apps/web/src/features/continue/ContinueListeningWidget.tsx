import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Headphones } from "lucide-react";
import { WidgetShell, WidgetHeader } from "@/pages/_component/widgetPrimitives";
import {
  useListeningProgress,
  useReadingProgress,
} from "@/features/player/usePlayback";
import { usePlayer } from "@/features/player/PlayerProvider";
import { BookCover } from "@/pages/books/_component/BookCover";
import { formatClock } from "@/features/player/formatClock";
import { continueItems } from "./continueItems";

export function ContinueListeningWidget() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const player = usePlayer();
  const listening = useListeningProgress();
  const reading = useReadingProgress();

  if (listening.isError && reading.isError) return null;
  if (listening.isLoading && reading.isLoading) return null;

  const items = continueItems(
    listening.data?.progress ?? [],
    reading.data?.progress ?? [],
  );
  if (items.length === 0) return null;

  return (
    <WidgetShell>
      <WidgetHeader icon={Headphones} title={t("dashboard.home.continue")} />
      <div className="divide-y divide-neutral-800/60">
        {items.map((item) => (
          <button
            key={`${item.kind}-${item.editionId}`}
            type="button"
            className="focus-ring flex w-full gap-3 px-4 py-3 text-left hover:bg-neutral-900/60"
            onClick={() => {
              if (item.kind === "audiobook") {
                void player.load(item.editionId, item.bookId);
                void navigate({
                  to: "/books/$bookId/listen",
                  params: { bookId: String(item.bookId) },
                });
                return;
              }
              void navigate({
                to: "/books/$bookId/read",
                params: { bookId: String(item.bookId) },
              });
            }}
          >
            <BookCover title={item.title} coverUrl={item.coverUrl} size="row" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-100">
                {item.title}
              </p>
              <p className="truncate text-xs text-neutral-500">
                {item.authors.join(", ")}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-neutral-500">
                {item.kind === "audiobook" && item.remainingSecs != null
                  ? formatClock(item.remainingSecs)
                  : `${Math.round(item.progressFraction * 100)}%`}
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full rounded-full bg-primary-500"
                  style={{
                    width: `${Math.round(item.progressFraction * 100)}%`,
                  }}
                />
              </div>
            </div>
          </button>
        ))}
      </div>
    </WidgetShell>
  );
}
