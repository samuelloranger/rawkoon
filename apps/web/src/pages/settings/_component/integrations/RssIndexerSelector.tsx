import { useTranslation } from "react-i18next";
import type { IndexerItem } from "@/pages/settings/useJackettIndexers";

interface RssIndexerSelectorProps {
  indexers: IndexerItem[] | undefined;
  loading: boolean;
  selected: string[];
  onChange: (slugs: string[]) => void;
}

export function RssIndexerSelector({
  indexers,
  loading,
  selected,
  onChange,
}: RssIndexerSelectorProps) {
  const { t } = useTranslation("common");

  const toggle = (slug: string) => {
    onChange(
      selected.includes(slug)
        ? selected.filter((s) => s !== slug)
        : [...selected, slug],
    );
  };

  return (
    <div>
      <p className="mb-2 block text-sm font-medium text-neutral-300">
        {t("settings.integrations.rssPolling.label")}
      </p>
      <p className="mb-3 text-xs text-neutral-400">
        {t("settings.integrations.rssPolling.help")}
      </p>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-9 rounded-lg bg-neutral-700 animate-pulse"
            />
          ))}
        </div>
      ) : !indexers?.length ? (
        <p className="text-sm text-neutral-500 italic">
          {t("settings.integrations.rssPolling.noIndexers")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {indexers.map((indexer) => {
            const isSelected = selected.includes(indexer.slug);
            return (
              <label
                key={indexer.slug}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-neutral-700 hover:bg-neutral-750 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(indexer.slug)}
                  className="w-4 h-4 rounded accent-primary-600"
                />
                <span className="text-sm text-neutral-200 flex-1">
                  {indexer.name}
                </span>
                {!indexer.enabled && (
                  <span className="text-xs text-neutral-500">
                    {t("settings.integrations.rssPolling.offline")}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
