import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { IndexerItem } from "@/pages/settings/useJackettIndexers";
import { IntegrationSectionCard } from "@/pages/settings/_component/integrations/IntegrationSectionCard";
import { IntegrationUrlInput } from "@/pages/settings/_component/integrations/IntegrationUrlInput";
import { RssIndexerSelector } from "@/pages/settings/_component/integrations/RssIndexerSelector";

interface IndexerManagerIntegration {
  website_url?: string;
  api_key?: string;
  enabled?: boolean;
  rss_indexers?: string[];
}

interface SaveIndexerManagerIntegrationInput {
  website_url: string;
  api_key: string;
  enabled: boolean;
  rss_indexers: string[];
}

interface IndexerManagerIntegrationSectionProps {
  data:
    | {
        integration?: IndexerManagerIntegration;
      }
    | undefined;
  isLoading: boolean;
  title: string;
  description: string;
  logoUrl: string;
  translationKey: "jackett" | "prowlarr";
  websiteUrlPlaceholder: string;
  saving: boolean;
  save: (input: SaveIndexerManagerIntegrationInput) => Promise<unknown>;
  useIndexers: (enabled: boolean) => {
    data: { indexers: IndexerItem[] } | undefined;
    isLoading: boolean;
  };
}

export function IndexerManagerIntegrationSection({
  data,
  isLoading,
  title,
  description,
  logoUrl,
  translationKey,
  websiteUrlPlaceholder,
  saving,
  save,
  useIndexers,
}: IndexerManagerIntegrationSectionProps) {
  const { t } = useTranslation("common");
  const integration = data?.integration;

  const [websiteUrl, setWebsiteUrl] = useState(integration?.website_url || "");
  const [apiKey, setApiKey] = useState(integration?.api_key || "");
  const [enabled, setEnabled] = useState(Boolean(integration?.enabled));
  const [rssIndexers, setRssIndexers] = useState<string[]>(
    integration?.rss_indexers ?? [],
  );

  const canFetchIndexers = Boolean(
    enabled && (integration?.website_url || websiteUrl),
  );
  const { data: indexersData, isLoading: indexersLoading } =
    useIndexers(canFetchIndexers);

  const isDirty = useMemo(() => {
    if (!integration) return false;
    const savedRss = integration.rss_indexers ?? [];
    return (
      websiteUrl !== (integration.website_url || "") ||
      apiKey !== (integration.api_key || "") ||
      enabled !== Boolean(integration.enabled) ||
      rssIndexers.length !== savedRss.length ||
      rssIndexers.some((indexer) => !savedRss.includes(indexer))
    );
  }, [apiKey, enabled, integration, rssIndexers, websiteUrl]);

  const handleCancel = () => {
    setWebsiteUrl(integration?.website_url || "");
    setApiKey(integration?.api_key || "");
    setEnabled(Boolean(integration?.enabled));
    setRssIndexers(integration?.rss_indexers ?? []);
  };

  const handleSave = () => {
    save({
      website_url: websiteUrl,
      api_key: apiKey,
      enabled,
      rss_indexers: rssIndexers,
    })
      .then(() => toast.success(t("settings.integrations.saveSuccess")))
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  return (
    <IntegrationSectionCard
      title={title}
      description={description}
      enabled={enabled}
      onEnabledChange={setEnabled}
      onCancel={handleCancel}
      onSave={handleSave}
      loading={isLoading}
      saving={saving}
      isDirty={isDirty}
      logoUrl={logoUrl}
    >
      <IntegrationUrlInput
        label={t(`settings.integrations.${translationKey}.websiteUrl`)}
        value={websiteUrl}
        onChange={setWebsiteUrl}
        placeholder={websiteUrlPlaceholder}
      />

      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-300">
          {t(`settings.integrations.${translationKey}.apiKey`)}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t(
            `settings.integrations.${translationKey}.apiKeyPlaceholder`,
          )}
          className="w-full rounded-lg border border-neutral-600 bg-neutral-900 px-4 py-2 font-mono text-white"
        />
      </div>

      <RssIndexerSelector
        indexers={indexersData?.indexers}
        loading={canFetchIndexers && indexersLoading}
        selected={rssIndexers}
        onChange={setRssIndexers}
      />
    </IntegrationSectionCard>
  );
}
