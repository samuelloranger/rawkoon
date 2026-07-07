import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { prefetchRouteData } from "@/lib/routing/prefetch";
import { WatchlistPage } from "@/pages/medias/_component/WatchlistPage";

export const Route = createFileRoute("/watchlist/")({
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
    await prefetchRouteData(context.queryClient, "/watchlist");
  },
  component: WatchlistPage,
});
