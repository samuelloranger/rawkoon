import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { BooksPage } from "@/pages/books/_component/BooksPage";

export const Route = createFileRoute("/books/")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: BooksPage,
});
