import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { AuthorsPage } from "@/pages/books/_component/AuthorsPage";

export const Route = createFileRoute("/books/authors")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: AuthorsPage,
});
