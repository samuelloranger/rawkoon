import { useNavigate, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, Headphones } from "lucide-react";
import type { BookEdition } from "@rawkoon/shared/types";
import { useEditionFiles } from "@/pages/books/_hooks/useBooks";
import { usePlayer } from "@/features/player/PlayerProvider";

export function EditionOpenActions({
  edition,
  bookId,
}: {
  edition: BookEdition;
  bookId: number;
}) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const player = usePlayer();
  const files = useEditionFiles(bookId, edition.kind, edition.kind === "ebook");
  const hasEpub = (files.data?.files ?? []).some((f) => f.format === "epub");
  const showListen = edition.kind === "audiobook" && edition.offline_ready;
  const showRead = edition.kind === "ebook" && files.isFetched && hasEpub;

  if (!showListen && !showRead) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {showListen && (
        <button
          type="button"
          className="focus-ring inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
          onClick={() => {
            void player.load(edition.id, bookId);
            void navigate({
              to: "/books/$bookId/listen",
              params: { bookId: String(bookId) },
            });
          }}
        >
          <Headphones className="h-4 w-4" />
          {t("books.listen.open")}
        </button>
      )}
      {showRead && (
        <Link
          to="/books/$bookId/read"
          params={{ bookId: String(bookId) }}
          className="focus-ring inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
        >
          <BookOpen className="h-4 w-4" />
          {t("books.read.open")}
        </Link>
      )}
    </div>
  );
}
