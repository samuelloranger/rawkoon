import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { prefetchRouteDataOptimistic } from "@/lib/routing/prefetch";
import { HomePage } from "@/pages/_component/HomePage";

export const Route = createFileRoute("/")({
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
  loader: ({ context }) => {
    prefetchRouteDataOptimistic(context.queryClient, "/");
  },
  component: HomePage,
});
