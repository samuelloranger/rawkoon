import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDoctor } from "@/pages/settings/useDoctor";
import type { DoctorStatus } from "@rawkoon/shared/types";

const ICONS: Record<
  DoctorStatus,
  { Icon: typeof CheckCircle2; className: string }
> = {
  ok: { Icon: CheckCircle2, className: "text-emerald-400" },
  warn: { Icon: AlertTriangle, className: "text-amber-400" },
  fail: { Icon: XCircle, className: "text-red-400" },
};

/** On-demand self-check of everything Rawkoon depends on (same report as `bun run doctor`). */
export function DoctorCard() {
  const { t } = useTranslation("common");
  const { data, isFetching, isError, refetch } = useDoctor();

  return (
    <section
      data-testid="doctor-card"
      className="rounded-xl border border-neutral-700 bg-neutral-800 p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">
            {t("settings.health.doctor.title")}
          </h3>
          <p className="mt-0.5 text-xs text-neutral-400">
            {isFetching
              ? t("settings.health.doctor.running")
              : data
                ? t(`settings.health.doctor.overall.${data.status}`)
                : t("settings.health.doctor.description")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t("settings.health.doctor.run")}
        </Button>
      </div>

      {isError && (
        <p className="mt-3 text-sm text-red-400">
          {t("settings.health.doctor.loadError")}
        </p>
      )}

      {data && (
        <ul className="mt-3 space-y-2">
          {data.checks.map((check) => {
            const { Icon, className } = ICONS[check.status];
            return (
              <li
                key={check.id}
                data-check={check.id}
                data-status={check.status}
                className="flex items-start gap-3 rounded-lg border border-neutral-700/60 bg-neutral-900/40 px-3 py-2.5"
              >
                <Icon
                  className={cn("mt-0.5 h-4 w-4 shrink-0", className)}
                  aria-label={t(
                    `settings.health.doctor.status.${check.status}`,
                  )}
                />
                <div className="min-w-0 flex-1 text-sm text-neutral-200">
                  <p>
                    <span className="font-medium">{check.title}</span>
                    {" — "}
                    {check.summary}
                  </p>
                  {check.status !== "ok" && check.fix && (
                    <p className="mt-1 text-xs text-neutral-400">{check.fix}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
