import { useEffect } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getCurrentUser } from "@/lib/auth";
import { useBook } from "@/pages/books/_hooks/useBooks";
import { usePlayer } from "@/features/player/PlayerProvider";

export const Route = createFileRoute("/books/$bookId/listen")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: ListenRoute,
});

/**
 * A deep link into the player. The player itself lives in the root layout, so
 * this route only loads the edition and expands it — playback then survives
 * navigating away from here.
 */
function ListenRoute() {
  const { bookId } = Route.useParams();
  const { t } = useTranslation("common");
  const { data: book } = useBook(Number(bookId));
  const { openEdition, state, setExpanded } = usePlayer();
  const edition = book?.item.editions.find(
    (candidate) => candidate.kind === "audiobook",
  );

  const editionId = edition?.id;

  // Depends on the id, not the edition object.
  //
  // `edition` is rebuilt by `.find()` on every render, so the effect re-ran on
  // every render — and `openEdition` invalidates its own in-flight work through
  // a request counter, so each re-run made the previous call bail after its
  // manifest await. Any background re-render (a query refetch, an SSE
  // reconnect) therefore starved the open indefinitely: the manifest was
  // fetched, no player ever appeared, and the route sat on "Opening the
  // player…" forever.
  useEffect(() => {
    if (editionId == null) return;
    if (state.editionId === editionId) {
      setExpanded(true);
      return;
    }
    // Autoplay is refused without a gesture on most platforms; the expanded
    // view opens paused and its play button is the gesture.
    void openEdition(editionId, false);
  }, [editionId, openEdition, setExpanded, state.editionId]);

  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-text-muted">
      {t("books.player.opening")}
    </div>
  );
}
