import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGrabReadiness } from "@/features/medias/hooks/useGrabReadiness";
import { useLibraryAttention } from "@/features/medias/hooks/useLibraryAttention";
import { failingChecks } from "@/features/medias/lib/grabReadiness";
import { LibraryAttentionPanel } from "@/pages/_component/LibraryAttentionPanel";
import { RssStatusPanel } from "@/pages/_component/RssStatusPanel";
import { DoctorCard } from "@/pages/settings/_component/DoctorCard";
import { GrabReadinessChecklist } from "@/pages/settings/_component/GrabReadinessChecklist";
import { LibraryHealthCard } from "@/pages/settings/_component/LibraryHealthCard";
import { SettingsPageShell } from "@/pages/settings/_component/SettingsPageShell";
import { useLibraryHealth } from "@/pages/settings/useLibraryHealth";

function Summary() {
  const { t } = useTranslation("common");
  const grab = useGrabReadiness();
  const attention = useLibraryAttention();
  const health = useLibraryHealth();

  if (grab.isLoading || attention.isLoading || health.isLoading) return null;

  const readinessFailures = failingChecks(grab.data?.checks ?? []).length;
  const alerts = attention.data?.items.length ?? 0;
  const libraryIssues = health.data?.latest?.summary.total_issues ?? 0;
  const ready = readinessFailures === 0;
  const allClear = ready && alerts === 0 && libraryIssues === 0;
  const Icon = ready ? CheckCircle2 : AlertTriangle;

  return (
    <div
      role="status"
      data-testid="health-summary"
      className={
        ready
          ? "flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-100"
          : "flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100"
      }
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-0.5 text-sm">
        <p>
          {allClear
            ? t("settings.health.allClear")
            : ready
              ? t("settings.health.readyToGrab")
              : t("settings.health.needsAttention", {
                  count: readinessFailures,
                })}
        </p>
        {ready && libraryIssues > 0 && (
          <p className="text-xs opacity-80">
            {t("settings.health.libraryIssues", { count: libraryIssues })}
          </p>
        )}
        {ready && alerts > 0 && (
          <p className="text-xs opacity-80">
            {t("settings.health.alertsOpen", { count: alerts })}
          </p>
        )}
      </div>
    </div>
  );
}

/** One page answering "can Rawkoon find, grab and import right now?". */
export function HealthPage() {
  const { t } = useTranslation("common");
  const health = useLibraryHealth();

  return (
    <SettingsPageShell id="health">
      <Summary />
      <section className="rounded-xl border border-neutral-700 bg-neutral-800 px-6 pb-6 pt-2">
        <GrabReadinessChecklist />
      </section>
      <section className="rounded-xl border border-neutral-700 bg-neutral-800 p-6">
        <h3 className="mb-3 text-sm font-semibold text-neutral-100">
          {t("settings.health.library")}
        </h3>
        <LibraryHealthCard latest={health.data?.latest ?? null} t={t} />
      </section>
      <DoctorCard />
      <LibraryAttentionPanel />
      <RssStatusPanel />
    </SettingsPageShell>
  );
}
