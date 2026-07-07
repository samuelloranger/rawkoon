import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { prefetchRouteData } from "@/lib/routing/prefetch";
import { LibraryPage } from "@/pages/medias/_component/LibraryPage";

type LibrarySearchParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: string;
  status?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  scrollToMedia?: string;
};

const parseOptionalInt = (val: unknown): number | undefined =>
  typeof val === "number"
    ? val
    : typeof val === "string" && val
      ? Number(val) || undefined
      : undefined;

export const Route = createFileRoute("/library/")({
  validateSearch: (search: Record<string, unknown>): LibrarySearchParams => ({
    page: parseOptionalInt(search.page),
    pageSize: parseOptionalInt(search.pageSize),
    search:
      typeof search.search === "string" && search.search
        ? search.search
        : undefined,
    type:
      typeof search.type === "string" && search.type ? search.type : undefined,
    status:
      typeof search.status === "string" && search.status
        ? search.status
        : undefined,
    sortBy:
      typeof search.sortBy === "string" && search.sortBy
        ? search.sortBy
        : undefined,
    sortDir:
      search.sortDir === "asc" || search.sortDir === "desc"
        ? search.sortDir
        : undefined,
    scrollToMedia:
      typeof search.scrollToMedia === "string"
        ? search.scrollToMedia
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
  loader: async ({ context }) => {
    await prefetchRouteData(context.queryClient, "/library");
  },
  component: LibraryPage,
});
