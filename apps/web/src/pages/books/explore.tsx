import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { BooksExplorePage } from "@/pages/books/_component/BooksExplorePage";

export const Route = createFileRoute("/books/explore")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: BooksExplorePage,
});
