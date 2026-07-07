import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { DownloadsImportPage } from "@/features/downloadsImport/DownloadsImportPage";

export const Route = createFileRoute("/library/downloads")({
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
  component: DownloadsImportPage,
});
