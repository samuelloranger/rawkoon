import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { prefetchRouteData } from "@/lib/routing/prefetch";
import { RecentActivityPage } from "@/pages/activity/_component/RecentActivityPage";

export const Route = createFileRoute("/activity/")({
  validateSearch: (search: Record<string, unknown>) => ({
    service: typeof search.service === "string" ? search.service : "",
    type: typeof search.type === "string" ? search.type : "",
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
  loaderDeps: ({ search: { service, type } }) => ({ service, type }),
  loader: async ({ context, deps }) => {
    await prefetchRouteData(context.queryClient, "/activity", deps);
  },
  component: RecentActivityPage,
});
