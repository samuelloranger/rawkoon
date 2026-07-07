import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import {
  LibraryItemPage,
  type LibraryItemSearchParams,
} from "@/pages/medias/_component/LibraryItemPage";

export const Route = createFileRoute("/library/$libraryId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): LibraryItemSearchParams => ({
    tab:
      typeof search.tab === "string" &&
      (
        ["info", "similar", "search", "management"] as readonly string[]
      ).includes(search.tab)
        ? (search.tab as LibraryItemSearchParams["tab"])
        : undefined,
  }),
  beforeLoad: async () => {
    try {
      const user = await getCurrentUser();
      if (!user) throw redirect({ to: "/login" });
      return { user };
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 429) return { user: null };
      throw e;
    }
  },
  component: LibraryItemPage,
});
