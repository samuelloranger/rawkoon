import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { prefetchRouteData } from "@/lib/routing/prefetch";
import { CollectionsPage } from "@/pages/medias/_component/CollectionsPage";

export const Route = createFileRoute("/collections/")({
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
    await prefetchRouteData(context.queryClient, "/collections");
  },
  component: CollectionsPage,
});
