import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getCurrentUser } from "@/lib/auth";
import { DiscoverDeck } from "@/pages/discover/_component/DiscoverDeck";

function DiscoverPage() {
  const { t } = useTranslation("common");
  return (
    <div className="page-transition px-4 py-6">
      <h1 className="mb-6 text-center font-display text-2xl font-semibold text-text-strong">
        {t("nav.discover")}
      </h1>
      <DiscoverDeck />
    </div>
  );
}

export const Route = createFileRoute("/discover/")({
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
  component: DiscoverPage,
});
