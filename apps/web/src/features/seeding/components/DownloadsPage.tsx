import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { HardDriveDownload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { DownloadsImportView } from "@/features/downloadsImport/DownloadsImportPage";
import { useOrphans } from "@/features/seeding/hooks/useOrphans";
import { useSeeding } from "@/features/seeding/hooks/useSeeding";
import { OrphansView } from "./OrphansView";
import { SeedingView } from "./SeedingView";

export type DownloadsView = "import" | "seeding" | "orphans";

export function DownloadsPage({ view }: { view: DownloadsView }) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const seeding = useSeeding();
  const orphans = useOrphans();
  const orphanCount = orphans.data?.orphans.length ?? 0;
  return (
    <PageLayout className="pb-28">
      <PageHeader
        icon={HardDriveDownload}
        title={t("downloadsPage.title")}
        subtitle={t("downloadsPage.subtitle")}
      />
      <SegmentedTabs
        items={[
          { id: "import", label: t("downloadsPage.tabs.import") },
          {
            id: "seeding",
            label: t("downloadsPage.tabs.seeding"),
            badge: seeding.data?.torrents.length,
          },
          {
            id: "orphans",
            label: t("downloadsPage.tabs.orphans"),
            badge: orphanCount > 0 ? orphanCount : undefined,
          },
        ]}
        value={view}
        onChange={(next) =>
          navigate({
            to: "/library/downloads",
            search: { view: next === "import" ? undefined : next },
          })
        }
        ariaLabel={t("downloadsPage.title")}
      />
      <div className="mt-5">
        {view === "import" && <DownloadsImportView />}
        {view === "seeding" && <SeedingView />}
        {view === "orphans" && <OrphansView />}
      </div>
    </PageLayout>
  );
}
