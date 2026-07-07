import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { prefetchRouteData } from "@/lib/routing/prefetch";
import { Settings, type Tab } from "@/pages/settings/_component/Settings";

type SettingsSearch = { tab: Tab; subtab?: string };

export const Route = createFileRoute("/settings/")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    tab: (search.tab as Tab) || "profile",
    subtab: search.subtab as string | undefined,
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
  loaderDeps: ({ search: { tab } }) => ({ tab }),
  loader: async ({ context, deps }) => {
    await prefetchRouteData(context.queryClient, "/settings", deps);
  },
  component: Settings,
});
