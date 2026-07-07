import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTmdbIntegration } from "@/pages/settings/useTmdbIntegration";
import { useUpdateTmdbIntegration } from "@/pages/settings/useUpdateTmdbIntegration";
import { toast } from "sonner";
import { IntegrationSectionCard } from "@/pages/settings/_component/integrations/IntegrationSectionCard";

export function TmdbIntegrationSection() {
  const { data, isLoading } = useTmdbIntegration();
  return (
    <TmdbIntegrationSectionImpl
      key={data?.integration?.type ?? "pending"}
      data={data}
      isLoading={isLoading}
    />
  );
}

function TmdbIntegrationSectionImpl({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useTmdbIntegration>["data"];
  isLoading: boolean;
}) {
  const { t } = useTranslation("common");
  const saveMutation = useUpdateTmdbIntegration();

  const [apiKey, setApiKey] = useState(data?.integration?.api_key || "");
  const [enabled, setEnabled] = useState(Boolean(data?.integration?.enabled));
  const [popularityThreshold, setPopularityThreshold] = useState(
    data?.integration?.popularity_threshold ?? 15,
  );

  const isDirty = useMemo(() => {
    if (!data?.integration) return false;
    return (
      apiKey !== (data.integration.api_key || "") ||
      enabled !== Boolean(data.integration.enabled) ||
      popularityThreshold !== (data.integration.popularity_threshold ?? 15)
    );
  }, [data, apiKey, enabled, popularityThreshold]);

  const handleCancel = () => {
    setApiKey(data?.integration.api_key || "");
    setEnabled(Boolean(data?.integration.enabled));
    setPopularityThreshold(data?.integration.popularity_threshold ?? 15);
  };

  const handleSave = () => {
    saveMutation
      .mutateAsync({
        api_key: apiKey,
        enabled,
        popularity_threshold: popularityThreshold,
      })
      .then(() => toast.success(t("settings.integrations.saveSuccess")))
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  return (
    <IntegrationSectionCard
      title="TMDB"
      description={t("settings.integrations.tmdb.help")}
      enabled={enabled}
      onEnabledChange={setEnabled}
      onCancel={handleCancel}
      onSave={handleSave}
      loading={isLoading}
      saving={saveMutation.isPending}
      isDirty={isDirty}
      logoUrl="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg"
    >
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-2">
          {t("settings.integrations.tmdb.apiKey")}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t("settings.integrations.tmdb.apiKeyPlaceholder")}
          className="w-full px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white font-mono"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-2">
          {t("settings.integrations.tmdb.popularityThreshold")}
        </label>
        <input
          type="number"
          min={0}
          max={100}
          value={popularityThreshold}
          onChange={(event) =>
            setPopularityThreshold(
              Math.max(0, Math.min(100, Number(event.target.value) || 0)),
            )
          }
          className="w-full px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white"
        />
        <p className="mt-1 text-xs text-neutral-400">
          {t("settings.integrations.tmdb.popularityThresholdHelp")}
        </p>
      </div>
    </IntegrationSectionCard>
  );
}
