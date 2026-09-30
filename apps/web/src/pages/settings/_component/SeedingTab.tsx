import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { Loader } from "@/components/Loader";
import { useMediaPostProcessingSettings } from "@/features/medias/hooks/useMediaPostProcessingSettings";
import { useSeeding } from "@/features/seeding/hooks/useSeeding";
import { SeedingSettingsSection } from "./SeedingSettingsSection";

export function SeedingTab() {
  const { t } = useTranslation("common");
  const { data, isLoading, error } = useMediaPostProcessingSettings();
  const seeding = useSeeding();
  const settings = data?.settings;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-neutral-500">
        <Loader size="md" />
        <span className="text-sm">{t("settings.mediaLibrary.loading")}</span>
      </div>
    );
  }
  if (error || !settings) {
    return (
      <p className="text-sm text-red-400">
        {t("settings.mediaLibrary.loadError")}
      </p>
    );
  }

  const held = seeding.data?.torrents.length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Share2 size={18} aria-hidden className="text-primary-300" />
          <div>
            <p className="text-sm font-medium text-neutral-100">
              {settings.seed_sweep_enabled
                ? t("settings.seeding.statusOn")
                : t("settings.seeding.statusOff")}
            </p>
            {held != null && (
              <p className="text-xs text-neutral-500">
                {t("settings.seeding.shared", { count: held })}
              </p>
            )}
          </div>
        </div>
        <a
          href="/library/downloads?view=seeding"
          className="text-sm text-primary-400 underline underline-offset-2"
        >
          {t("settings.seeding.viewTorrents")}
        </a>
      </div>
      <SeedingSettingsSection
        key={`seed-${settings.updated_at}`}
        settings={settings}
      />
    </div>
  );
}
