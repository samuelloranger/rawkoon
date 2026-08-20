import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { BookDetailPage } from "@/pages/books/_component/BookDetailPage";

export const Route = createFileRoute("/books/$bookId")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: BookDetailRoute,
});

function BookDetailRoute() {
  const { bookId } = Route.useParams();
  return <BookDetailPage bookId={Number(bookId)} />;
}
