import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { ListeningStatsPage } from "@/features/listening/ListeningStatsPage";

export const Route = createFileRoute("/stats/")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
  },
  component: ListeningStatsPage,
});
