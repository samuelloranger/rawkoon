import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  AI_CALL_STATUSES,
  AI_FEATURES,
  type AiCallEntry,
} from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AI_CALLS_PAGE_SIZE, useAiCalls } from "@/pages/settings/useAiCalls";
import {
  formatCost,
  formatMs,
  formatTokens,
} from "@/pages/settings/_component/ai/aiFormat";

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-green-500/10 text-green-400",
  invalid_pick: "bg-yellow-500/10 text-yellow-400",
  rate_limited: "bg-orange-500/10 text-orange-400",
  error: "bg-red-500/10 text-red-400",
};

const SELECT_CLASS =
  "focus-ring rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-100";

function TargetCell({ call }: { call: AiCallEntry }) {
  if (call.media_id != null && call.media_title) {
    return (
      <Link
        to="/library/$libraryId"
        params={{ libraryId: String(call.media_id) }}
        className="text-neutral-100 hover:text-primary-400"
      >
        {call.media_title}
      </Link>
    );
  }
  if (call.book_id != null && call.book_title) {
    return (
      <Link
        to="/books/$bookId"
        params={{ bookId: String(call.book_id) }}
        className="text-neutral-100 hover:text-primary-400"
      >
        {call.book_title}
      </Link>
    );
  }
  return <span className="text-neutral-500">—</span>;
}

export function AiCallHistory() {
  const { t, i18n } = useTranslation("common");
  const [page, setPage] = useState(1);
  const [feature, setFeature] = useState("");
  const [status, setStatus] = useState("");
  const { data, isLoading, isError } = useAiCalls({ page, feature, status });

  const totalPages = Math.max(
    1,
    Math.ceil((data?.total ?? 0) / AI_CALLS_PAGE_SIZE),
  );
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-100">
          {t("settings.ai.history.title")}
        </h3>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={t("settings.ai.history.feature")}
            value={feature}
            onChange={(e) => {
              setFeature(e.target.value);
              setPage(1);
            }}
            className={SELECT_CLASS}
          >
            <option value="">{t("settings.ai.history.allFeatures")}</option>
            {AI_FEATURES.map((f) => (
              <option key={f} value={f}>
                {t(`settings.ai.features.${f}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("settings.ai.history.status")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className={SELECT_CLASS}
          >
            <option value="">{t("settings.ai.history.allStatuses")}</option>
            {AI_CALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`settings.ai.statuses.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isError && (
        <p className="text-sm text-red-400">{t("settings.ai.loadError")}</p>
      )}
      {isLoading && (
        <p className="text-sm text-neutral-500">{t("settings.ai.loading")}</p>
      )}
      {data && data.calls.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
          {t("settings.ai.history.empty")}
        </p>
      )}

      {data && data.calls.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900 text-[11px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-2">{t("settings.ai.history.time")}</th>
                <th className="px-3 py-2">
                  {t("settings.ai.history.feature")}
                </th>
                <th className="px-3 py-2">{t("settings.ai.history.status")}</th>
                <th className="px-3 py-2">{t("settings.ai.stats.tokens")}</th>
                <th className="px-3 py-2">
                  {t("settings.ai.history.duration")}
                </th>
                <th className="px-3 py-2">{t("settings.ai.stats.cost")}</th>
                <th className="px-3 py-2">{t("settings.ai.history.target")}</th>
                <th className="px-3 py-2">
                  {t("settings.ai.history.reasoning")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 text-neutral-300">
              {data.calls.map((call) => (
                <tr key={call.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    {dateFormat.format(new Date(call.created_at))}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2"
                    title={call.model}
                  >
                    {t(`settings.ai.features.${call.feature}`, {
                      defaultValue: call.feature,
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      title={call.error ?? undefined}
                      className={cn(
                        "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_STYLES[call.status],
                      )}
                    >
                      {t(`settings.ai.statuses.${call.status}`)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatTokens(call.input_tokens)} /{" "}
                    {formatTokens(call.output_tokens)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatMs(call.duration_ms)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatCost(call.estimated_cost)}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2">
                    <TargetCell call={call} />
                  </td>
                  <td
                    className="max-w-56 truncate px-3 py-2 text-neutral-400"
                    title={call.reasoning ?? call.error ?? undefined}
                  >
                    {call.reasoning ?? call.error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > AI_CALLS_PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-neutral-500">
            {t("settings.ai.history.page", { page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("settings.ai.history.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("settings.ai.history.next")}
          </Button>
        </div>
      )}
    </section>
  );
}
