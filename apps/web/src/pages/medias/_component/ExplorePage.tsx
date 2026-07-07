import { useTranslation } from "react-i18next";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { MediasExplore } from "@/pages/medias/_component/MediasExplore";
import { Compass } from "lucide-react";

export function ExplorePage() {
  const { t } = useTranslation("common");
  const queryClient = useQueryClient();
  const isFetching = useIsFetching({ queryKey: queryKeys.medias.explore() });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.medias.explore() });
  };

  return (
    <PageLayout>
      <PageHeader
        icon={Compass}
        iconColor="text-primary-400"
        title={t("medias.explore.pageTitle")}
        subtitle={t("medias.explore.pageSubtitle")}
        onRefresh={handleRefresh}
        isRefreshing={isFetching > 0}
      />
      <MediasExplore />
    </PageLayout>
  );
}
