import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { prefetchRouteData } from "@/lib/routing/prefetch";
import { ExplorePage } from "@/pages/medias/_component/ExplorePage";

type ExploreSearchParams = {
  type?: "movie" | "tv";
  provider?: number;
  genre?: number;
  sort?: string;
  page?: number;
  lang?: string;
};

const parseOptionalInt = (val: unknown): number | undefined =>
  typeof val === "number"
    ? val
    : typeof val === "string" && val
      ? Number(val) || undefined
      : undefined;

export const Route = createFileRoute("/explore/")({
  validateSearch: (search: Record<string, unknown>): ExploreSearchParams => ({
    type:
      search.type === "movie" || search.type === "tv" ? search.type : undefined,
    provider: parseOptionalInt(search.provider),
    genre: parseOptionalInt(search.genre),
    sort:
      typeof search.sort === "string" && search.sort ? search.sort : undefined,
    page: parseOptionalInt(search.page),
    lang:
      typeof search.lang === "string" && search.lang ? search.lang : undefined,
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
    await prefetchRouteData(context.queryClient, "/explore");
  },
  component: ExplorePage,
});
