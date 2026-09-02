import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { ListenPage } from "@/features/player/ListenPage";

export const Route = createFileRoute("/books/$bookId/listen")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: ListenRoute,
});

function ListenRoute() {
  const { bookId } = Route.useParams();
  return <ListenPage bookId={Number(bookId)} />;
}
