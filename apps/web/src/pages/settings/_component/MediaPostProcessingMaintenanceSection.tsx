import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AdvancedDisclosure } from "@/components/ui/advanced-disclosure";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-field";
import { useLibraryScan } from "@/features/medias/hooks/useLibraryScan";
import { useReindexLanguages } from "@/features/medias/hooks/useReindexLanguages";
import { useReindexLanguagesStatus } from "@/features/medias/hooks/useReindexLanguagesStatus";
import {
  LABEL_CLASS,
  SELECT_CLASS,
} from "@/pages/settings/_component/MediaPostProcessingForm";
import { CardSection } from "@/pages/settings/_component/MediaPostProcessingCardParts";

export function MediaPostProcessingMaintenanceSection() {
  const { t } = useTranslation("common");
  const scanMut = useLibraryScan();
  const [scanPath, setScanPath] = useState("");
  const [scanType, setScanType] = useState<"movie" | "show">("movie");
  const [lastScan, setLastScan] = useState<{
    matched: number;
    unmatched: string[];
  } | null>(null);

  const onScan = async () => {
    const p = scanPath.trim();
    if (!p) {
      toast.error(t("settings.mediaLibrary.scanPath"));
      return;
    }
    setLastScan(null);
    try {
      const res = await scanMut.mutateAsync({ path: p, type: scanType });
      setLastScan({ matched: res.matched, unmatched: res.unmatched });
      toast.success(
        t("settings.mediaLibrary.scanResult", { count: res.matched }),
      );
    } catch {
      toast.error(t("settings.mediaLibrary.scanError"));
    }
  };

  return (
    <AdvancedDisclosure label={t("settings.library.maintenance")}>
      {/* ── Library scan ─────────────────────────────────────────────── */}
      <CardSection
        title={t("settings.mediaLibrary.scanTitle")}
        description={t("settings.mediaLibrary.scanDescription")}
      >
        <FormInput
          label={t("settings.mediaLibrary.scanPath")}
          value={scanPath}
          onChange={(e) => setScanPath(e.target.value)}
          placeholder="/data/Movies"
          className="font-mono text-xs"
        />
        <div>
          <label
            htmlFor="media-post-processing-settings-body-scan-type"
            className={LABEL_CLASS}
          >
            {t("settings.mediaLibrary.scanType")}
          </label>
          <select
            id="media-post-processing-settings-body-scan-type"
            value={scanType}
            onChange={(e) =>
              setScanType(e.target.value === "show" ? "show" : "movie")
            }
            className={SELECT_CLASS}
          >
            <option value="movie">
              {t("settings.mediaLibrary.scanMovies")}
            </option>
            <option value="show">{t("settings.mediaLibrary.scanShows")}</option>
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onScan()}
          disabled={scanMut.isPending}
        >
          {scanMut.isPending
            ? t("settings.mediaLibrary.scanRunning")
            : t("settings.mediaLibrary.scanRun")}
        </Button>
        {lastScan && lastScan.unmatched.length > 0 && (
          <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/40 p-3 text-xs text-neutral-400">
            <p className="font-medium text-neutral-200 mb-1.5">
              {t("settings.mediaLibrary.scanUnmatched")} (
              {lastScan.unmatched.length})
            </p>
            <ul className="list-disc pl-4 max-h-40 overflow-y-auto font-mono space-y-0.5">
              {lastScan.unmatched.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}
      </CardSection>

      {/* ── Reindex languages ────────────────────────────────────────── */}
      <ReindexLanguagesSection />
    </AdvancedDisclosure>
  );
}

function ReindexLanguagesSection() {
  const { t } = useTranslation("common");
  const reindexMut = useReindexLanguages();
  const { data: status } = useReindexLanguagesStatus();
  const isRunning = status?.state === "active" || status?.state === "waiting";

  const onStart = async () => {
    try {
      await reindexMut.mutateAsync();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
      <div className="border-b border-neutral-700/60 px-6 py-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          {t("medias.library.reindexLanguagesButton")}
        </h2>
      </div>
      <div className="space-y-3 p-6">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onStart()}
          disabled={isRunning || reindexMut.isPending}
        >
          {isRunning && status?.progress
            ? t("medias.library.reindexLanguagesRunning", {
                current: status.progress.current,
                total: status.progress.total,
              })
            : t("medias.library.reindexLanguagesButton")}
        </Button>
        {status?.state === "completed" && status.result && (
          <p className="text-xs text-neutral-400">
            {t("medias.library.reindexLanguagesDone", {
              updated: status.result.updated,
              errors: status.result.errors,
            })}
          </p>
        )}
        {status?.state === "failed" && status.error && (
          <p className="text-xs text-red-400">{status.error}</p>
        )}
      </div>
    </div>
  );
}
