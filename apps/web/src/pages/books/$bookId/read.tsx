import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { ReaderPage } from "@/features/reader/ReaderPage";

export const Route = createFileRoute("/books/$bookId/read")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: ReadRoute,
});

function ReadRoute() {
  const { bookId } = Route.useParams();
  return <ReaderPage bookId={Number(bookId)} />;
}
