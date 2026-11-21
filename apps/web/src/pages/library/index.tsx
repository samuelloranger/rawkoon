import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { prefetchRouteData } from "@/lib/routing/prefetch";
import {
  parseFilterStatus,
  parseFilterType,
  parseSortDir,
  parseSortKey,
  parseViewMode,
  type FilterStatus,
  type FilterType,
  type SortDir,
  type SortKey,
  type ViewMode,
} from "@/utils/libraryUtils";
import { LibraryPage } from "@/pages/medias/_component/LibraryPage";

type LibrarySearchParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: FilterType;
  status?: FilterStatus;
  language?: string;
  sortBy?: SortKey;
  sortDir?: SortDir;
  view?: ViewMode;
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
    type: parseFilterType(search.type),
    status: parseFilterStatus(search.status),
    language:
      typeof search.language === "string" && search.language
        ? search.language
        : undefined,
    sortBy: parseSortKey(search.sortBy),
    sortDir: parseSortDir(search.sortDir),
    view: parseViewMode(search.view),
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
    // A failed prefetch falls through to the grid's own LoadError + Retry.
    await prefetchRouteData(context.queryClient, "/library").catch(() => {});
  },
  component: LibraryPage,
});
