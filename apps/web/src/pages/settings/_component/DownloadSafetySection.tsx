import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { MediaPostProcessingSettings } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { useUpdateMediaPostProcessingSettings } from "@/features/medias/hooks/useUpdateMediaPostProcessingSettings";
import { useJanitorStats } from "@/features/seeding/hooks/useJanitorStats";
import { ExtensionChipInput } from "./ExtensionChipInput";

export function DownloadSafetySection({
  settings,
}: {
  settings: MediaPostProcessingSettings;
}) {
  const { t } = useTranslation("common");
  const update = useUpdateMediaPostProcessingSettings();
  const stats = useJanitorStats();
  const [exts, setExts] = useState(settings.blocked_extensions);

  const onSave = async () => {
    try {
      await update.mutateAsync({ blocked_extensions: exts });
      toast.success(t("settings.downloadSafety.saved"));
    } catch {
      toast.error(t("settings.downloadSafety.saveError"));
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-neutral-700 bg-neutral-900/50 p-5">
      <div>
        <h2 className="text-xl">{t("settings.downloadSafety.title")}</h2>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-400">
          {t("settings.downloadSafety.description")}
        </p>
      </div>
      <ExtensionChipInput value={exts} onChange={setExts} />
      {stats.data && (
        <p className="text-sm text-neutral-400">
          {t("settings.downloadSafety.stats", {
            malware: stats.data.malware,
            stalled: stats.data.stalled,
            imports: stats.data.import_rejected,
          })}{" "}
          <a
            href="/settings?tab=blocklist"
            className="text-primary-400 underline underline-offset-2"
          >
            {t("settings.downloadSafety.statsLink")}
          </a>
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" onClick={onSave} disabled={update.isPending}>
          {t("settings.downloadSafety.save")}
        </Button>
      </div>
    </section>
  );
}
