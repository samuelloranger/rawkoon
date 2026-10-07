import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AI_STATS_PERIODS,
  type AiDailyStats,
  type AiGrabOutcome,
  type AiStatsPeriod,
  type AiUsageMetrics,
} from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import { useAiStats } from "@/pages/settings/useAiStats";
import {
  formatCost,
  formatMs,
  formatPercent,
  formatTokens,
} from "@/pages/settings/_component/ai/aiFormat";

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
        {label}
      </div>
      <div className="mt-0.5 font-display text-xl font-semibold text-neutral-50">
        {value}
      </div>
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

function DailyBars({
  daily,
  pick,
  format,
  barClass,
  label,
}: {
  daily: AiDailyStats[];
  pick: (d: AiDailyStats) => number;
  format: (n: number) => string;
  barClass: string;
  label: string;
}) {
  // Costs are fractions of a cent, so scale to the real max rather than a floor of 1.
  const max = Math.max(0, ...daily.map(pick)) || 1;
  return (
    <div>
      <div className="mb-1 text-xs text-neutral-400">{label}</div>
      <div className="flex h-20 items-end gap-px" role="img" aria-label={label}>
        {daily.map((d) => {
          const value = pick(d);
          return (
            <div
              key={d.date}
              title={`${d.date}: ${format(value)}`}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <div
                className={cn("w-full rounded-t-sm", barClass)}
                style={{
                  height:
                    value > 0 ? `${Math.max(4, (value / max) * 100)}%` : "1px",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricsTable({
  rows,
  nameHeader,
}: {
  rows: Array<{ name: string; metrics: AiUsageMetrics }>;
  nameHeader: string;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-900 text-[11px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="px-3 py-2">{nameHeader}</th>
            <th className="px-3 py-2">{t("settings.ai.stats.calls")}</th>
            <th className="px-3 py-2">{t("settings.ai.stats.successRate")}</th>
            <th className="px-3 py-2">{t("settings.ai.stats.tokens")}</th>
            <th className="px-3 py-2">{t("settings.ai.stats.changedPick")}</th>
            <th className="px-3 py-2">{t("settings.ai.stats.p50")}</th>
            <th className="px-3 py-2">{t("settings.ai.stats.cost")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800 text-neutral-300">
          {rows.map(({ name, metrics }) => (
            <tr key={name}>
              <td className="px-3 py-2 text-neutral-100">{name}</td>
              <td className="px-3 py-2">{metrics.calls}</td>
              <td className="px-3 py-2">
                {formatPercent(metrics.success_rate)}
              </td>
              <td className="px-3 py-2">
                {formatTokens(metrics.total_tokens)}
              </td>
              <td className="px-3 py-2">
                {metrics.agreement_rate == null
                  ? "—"
                  : formatPercent(1 - metrics.agreement_rate)}
              </td>
              <td className="px-3 py-2">{formatMs(metrics.p50_duration_ms)}</td>
              <td className="px-3 py-2">
                {formatCost(metrics.estimated_cost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GrabOutcomeCard({
  label,
  outcome,
}: {
  label: string;
  outcome: AiGrabOutcome;
}) {
  const { t } = useTranslation("common");
  const settled = outcome.completed + outcome.failed;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-sm font-medium text-neutral-100">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-50">
        {settled > 0 ? formatPercent(outcome.failed / settled) : "—"}
        <span className="ml-2 text-xs font-normal text-neutral-500">
          {t("settings.ai.grabs.failureRate")}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-400">
        {t("settings.ai.grabs.counts", {
          total: outcome.total,
          completed: outcome.completed,
          failed: outcome.failed,
          active: outcome.active,
        })}
      </div>
    </div>
  );
}

export function AiStatsPanel() {
  const { t } = useTranslation("common");
  const [days, setDays] = useState<AiStatsPeriod>(30);
  const { data, isLoading, isError } = useAiStats(days);

  const totals = data?.totals;
  const empty = !isLoading && !isError && (totals?.calls ?? 0) === 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-100">
          {t("settings.ai.usageTitle")}
        </h3>
        <div
          role="group"
          aria-label={t("settings.ai.period.label")}
          className="inline-flex rounded-lg border border-neutral-700 p-0.5"
        >
          {AI_STATS_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={days === p}
              onClick={() => setDays(p)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                days === p
                  ? "bg-primary-500/10 text-primary-400"
                  : "text-neutral-400 hover:text-neutral-200",
              )}
            >
              {t("settings.ai.period.days", { count: p })}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-neutral-500">{t("settings.ai.loading")}</p>
      )}
      {isError && (
        <p className="text-sm text-red-400">{t("settings.ai.loadError")}</p>
      )}
      {empty && (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
          {t("settings.ai.empty")}
        </p>
      )}

      {data && totals && !empty && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile
              label={t("settings.ai.stats.calls")}
              value={String(totals.calls)}
              hint={t("settings.ai.stats.callsHint", {
                invalid: totals.invalid_pick,
                limited: totals.rate_limited,
                errors: totals.error,
              })}
            />
            <Tile
              label={t("settings.ai.stats.successRate")}
              value={formatPercent(totals.success_rate)}
            />
            <Tile
              label={t("settings.ai.stats.tokens")}
              value={`${formatTokens(totals.input_tokens)} / ${formatTokens(totals.output_tokens)}`}
              hint={t("settings.ai.stats.tokensHint")}
            />
            <Tile
              label={t("settings.ai.stats.cost")}
              value={
                data.prices_configured ? formatCost(totals.estimated_cost) : "—"
              }
              hint={
                data.prices_configured
                  ? undefined
                  : t("settings.ai.stats.setPrices")
              }
            />
            <Tile
              label={t("settings.ai.stats.changedPick")}
              value={
                totals.agreement_rate == null
                  ? "—"
                  : formatPercent(1 - totals.agreement_rate)
              }
              hint={
                totals.agreement_rate == null
                  ? t("settings.ai.stats.changedPickNone")
                  : t("settings.ai.stats.changedPickHint", {
                      count: totals.agreement_checked,
                    })
              }
            />
            <Tile
              label={t("settings.ai.stats.p50")}
              value={formatMs(totals.p50_duration_ms)}
            />
            <Tile
              label={t("settings.ai.stats.p95")}
              value={formatMs(totals.p95_duration_ms)}
            />
          </div>

          <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <DailyBars
              daily={data.daily}
              pick={(d) => d.calls}
              format={(n) => t("settings.ai.chart.callsValue", { count: n })}
              barClass="bg-primary-500/70"
              label={t("settings.ai.chart.calls")}
            />
            {data.prices_configured && (
              <DailyBars
                daily={data.daily}
                pick={(d) => d.estimated_cost ?? 0}
                format={formatCost}
                barClass="bg-amber-500/70"
                label={t("settings.ai.chart.cost")}
              />
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("settings.ai.byFeature")}
            </h4>
            <MetricsTable
              nameHeader={t("settings.ai.history.feature")}
              rows={data.by_feature.map((f) => ({
                name: t(`settings.ai.features.${f.feature}`, {
                  defaultValue: f.feature,
                }),
                metrics: f,
              }))}
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("settings.ai.byTrigger")}
            </h4>
            <MetricsTable
              nameHeader={t("settings.ai.history.trigger")}
              rows={data.by_trigger.map((r) => ({
                name: r.trigger
                  ? t(`settings.ai.triggers.${r.trigger}`, {
                      defaultValue: r.trigger,
                    })
                  : t("settings.ai.triggers.unknown"),
                metrics: r,
              }))}
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("settings.ai.byModel")}
            </h4>
            <MetricsTable
              nameHeader={t("settings.ai.history.model")}
              rows={data.by_model.map((m) => ({ name: m.model, metrics: m }))}
            />
          </div>
        </>
      )}

      {data && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("settings.ai.grabs.title")}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <GrabOutcomeCard
              label={t("settings.ai.grabs.ai")}
              outcome={data.grabs.ai}
            />
            <GrabOutcomeCard
              label={t("settings.ai.grabs.classic")}
              outcome={data.grabs.classic}
            />
          </div>
        </div>
      )}
    </section>
  );
}
