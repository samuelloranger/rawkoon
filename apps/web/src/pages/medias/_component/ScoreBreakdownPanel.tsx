import { useTranslation } from "react-i18next";
import type { ScoreBreakdownDto } from "@rawkoon/shared/types";
import { codeKey, COMPONENT_CODE_KEYS } from "@/lib/i18n/scoringCodes";

interface Props {
  breakdown: ScoreBreakdownDto;
}

export function ScoreBreakdownPanel({ breakdown }: Props) {
  const { t } = useTranslation();

  // Only render for passing (non-rejected) releases; rejection reasons live in the amber block
  if (breakdown.rejected) return null;

  return (
    <div className="mt-2 rounded-xl border px-3 py-2.5 border-violet-700/40 bg-violet-950/20">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
          {t("customFormats.scoreBreakdown")}
        </p>
        {breakdown.total != null && (
          <span className="text-sm font-bold text-violet-300">
            {breakdown.total > 0 ? `+${breakdown.total}` : breakdown.total}
          </span>
        )}
      </div>

      {breakdown.components.length > 0 && (
        <ul className="space-y-0.5">
          {breakdown.components.map((c, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-neutral-400">
                {t(codeKey(COMPONENT_CODE_KEYS, c.code), c.params ?? {})}
              </span>
              <span
                className={
                  c.value >= 0
                    ? "font-medium text-emerald-400"
                    : "font-medium text-red-400"
                }
              >
                {c.value >= 0 ? `+${c.value}` : c.value}
              </span>
            </li>
          ))}
        </ul>
      )}

      {breakdown.matched_formats.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {breakdown.matched_formats.map((fmt) => (
            <span
              key={fmt}
              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/20 text-violet-300"
            >
              {fmt}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
