import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { DownloadsPage } from "@/features/seeding/components/DownloadsPage";

type DownloadsSearch = { view?: "seeding" | "orphans" };

export const Route = createFileRoute("/library/downloads")({
  validateSearch: (search: Record<string, unknown>): DownloadsSearch => ({
    view:
      search.view === "seeding" || search.view === "orphans"
        ? search.view
        : undefined,
  }),
  beforeLoad: async () => {
    try {
      const user = await getCurrentUser();
      if (!user) throw redirect({ to: "/login" });
      if (!user.is_admin) throw redirect({ to: "/library", replace: true });
      return { user };
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 429) return { user: null };
      throw e;
    }
  },
  component: DownloadsRoute,
});

function DownloadsRoute() {
  const { view } = Route.useSearch();
  return <DownloadsPage view={view ?? "import"} />;
}
