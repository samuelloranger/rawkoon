import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { RequestsPage } from "@/pages/requests/_component/RequestsPage";

export const Route = createFileRoute("/requests/")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: RequestsPage,
});
