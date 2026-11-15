import { useTranslation } from "react-i18next";
import type { SeasonMode } from "@rawkoon/shared/types";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  episodeFlags,
  formatSeasonList,
  latestSeason,
  planSummary,
  wantsNewSeasons,
  type PlanSeason,
  type SeasonChoice,
} from "./seasonPlan";

const SEASON_MODES: SeasonMode[] = ["all", "future", "latest", "pick"];

function SeasonSummary({
  seasons,
  choice,
}: {
  seasons: PlanSeason[];
  choice: SeasonChoice;
}) {
  const { t } = useTranslation("common");
  const s = planSummary(seasons, choice);
  const strong = "font-semibold text-neutral-50";
  let body: React.ReactNode;
  if (s.episodes === 0 && !s.newSeasons) {
    body = t("addDialog.summary.nothing");
  } else {
    const span = t(
      s.seasons.length === 1
        ? "addDialog.summary.fromSeason"
        : "addDialog.summary.fromSeasons",
      { list: formatSeasonList(s.seasons) },
    );
    body = (
      <>
        {s.episodes > 0 ? (
          <>
            {t("addDialog.summary.gets")}{" "}
            <b className={strong}>
              {t("addDialog.summary.episodes", { count: s.episodes })}
            </b>{" "}
            {span}
          </>
        ) : (
          t("addDialog.summary.getsNothing")
        )}
        {s.newSeasons ? (
          <>
            {t("addDialog.summary.plus")}{" "}
            <b className={strong}>{t("addDialog.summary.newSeasons")}</b>{" "}
            {t("addDialog.summary.asTheyAir")}
          </>
        ) : (
          "."
        )}
      </>
    );
  }
  return (
    <p
      aria-live="polite"
      className="mt-2.5 min-h-5 px-0.5 text-[13.5px] text-neutral-400"
    >
      {body}
    </p>
  );
}

/** One bar per episode (lit = will be grabbed, outlined = not aired), a dashed box for an announced season. */
function SeasonStrip({
  seasons,
  choice,
  onTogglePick,
}: {
  seasons: PlanSeason[];
  choice: SeasonChoice;
  /** Present only in pick mode: seasons become checkboxes. */
  onTogglePick?: (season: number) => void;
}) {
  const { t } = useTranslation("common");
  const latest = latestSeason(seasons);
  const newSeasons = wantsNewSeasons(choice);
  return (
    <div
      className="relative flex items-end gap-1.5 overflow-x-auto rounded-[14px] border border-border bg-surface-inset px-3 pb-2.5 pt-[26px]"
      data-testid="season-strip"
    >
      {seasons.map((s) => {
        const label = t("addDialog.seasonLabel", { n: s.number });
        const common =
          "flex min-w-[46px] flex-1 shrink-0 flex-col items-center gap-2 rounded-[10px] px-1 pb-0.5 pt-1";
        if (s.announced) {
          const lit = choice.mode === "future" || newSeasons;
          return (
            <div
              key={s.number}
              className={common}
              data-lit={lit}
              aria-label={label}
            >
              <div className="flex h-[38px] w-[34px] items-end justify-center">
                <div
                  className={cn(
                    "h-5 w-[30px] rounded-[5px] border-[1.5px] border-dashed border-border-strong transition-all motion-reduce:transition-none",
                    lit &&
                      "h-[26px] border-solid border-primary-600 bg-primary-600/35",
                  )}
                />
              </div>
              <span className="flex items-center gap-[5px] font-display text-[15px] font-semibold leading-none text-neutral-400">
                S{s.number}
              </span>
              <span className="-mt-1 text-[11.5px] text-neutral-400">
                {s.year ?? t("addDialog.soon")}
              </span>
            </div>
          );
        }
        const flags = episodeFlags(s, choice, latest);
        const lit = flags.some((f) => f.on);
        const aired = flags.filter((f) => !f.future).length;
        const mixed = aired > 0 && aired < flags.length;
        const pickable = onTogglePick != null;
        const inner = (
          <>
            <div className="relative flex h-[38px] items-end gap-[3px]">
              {flags.map((f, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-1 rounded-sm bg-[#3d3a34] transition-[background-color,height] motion-reduce:transition-none",
                    f.future
                      ? "h-4 bg-transparent shadow-[inset_0_0_0_1px_var(--color-border)]"
                      : "h-[22px]",
                    f.on && !f.future && "h-[30px] bg-primary-400",
                    f.on && f.future && "h-6 bg-primary-600 shadow-none",
                  )}
                />
              ))}
              {mixed && (
                <div
                  className="pointer-events-none absolute -top-1.5 -bottom-1 w-0 border-l-[1.5px] border-dashed border-[#a8bba0]"
                  style={{ left: `${(aired / flags.length) * 100}%` }}
                >
                  <span className="absolute -left-3.5 -top-4 whitespace-nowrap text-[10.5px] text-[#a8bba0]">
                    {t("addDialog.today")}
                  </span>
                </div>
              )}
            </div>
            <span
              className={cn(
                "flex items-center gap-[5px] font-display text-[15px] font-semibold leading-none",
                lit ? "text-neutral-50" : "text-neutral-400",
              )}
            >
              {pickable && (
                <span
                  aria-hidden
                  className={cn(
                    "grid size-[15px] place-items-center rounded border-[1.5px] border-border-strong",
                    lit && "border-primary-400 bg-primary-400",
                  )}
                >
                  {lit && (
                    <span className="mb-px h-1 w-[7px] -rotate-45 border-b-2 border-l-2 border-neutral-950" />
                  )}
                </span>
              )}
              S{s.number}
            </span>
            <span className="-mt-1 text-[11.5px] text-neutral-400">
              {s.year}
            </span>
          </>
        );
        return pickable ? (
          <button
            key={s.number}
            type="button"
            aria-pressed={lit}
            aria-label={label}
            data-lit={lit}
            onClick={() => onTogglePick(s.number)}
            className={cn(common, "focus-ring hover:bg-primary-400/5")}
          >
            {inner}
          </button>
        ) : (
          <div
            key={s.number}
            className={common}
            data-lit={lit}
            aria-label={label}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** Mode chips, the strip, its summary sentence and the new-seasons switch: the one place a season choice is made. */
export function SeasonPicker({
  seasons,
  choice,
  onChange,
  showNewSeasons = true,
  newSeasonsHint,
}: {
  seasons: PlanSeason[];
  choice: SeasonChoice;
  onChange: (next: SeasonChoice) => void;
  showNewSeasons?: boolean;
  newSeasonsHint?: string;
}) {
  const { t } = useTranslation("common");
  const setMode = (mode: SeasonMode) => {
    // Switching to Pick with nothing chosen starts from the newest aired season.
    const picked =
      mode === "pick" && choice.picked.length === 0
        ? [latestSeason(seasons) ?? seasons[seasons.length - 1]?.number].filter(
            (n): n is number => n != null,
          )
        : choice.picked;
    onChange({ ...choice, mode, picked });
  };
  const togglePick = (n: number) =>
    onChange({
      ...choice,
      picked: choice.picked.includes(n)
        ? choice.picked.filter((x) => x !== n)
        : [...choice.picked, n].sort((a, b) => a - b),
    });
  const forced = choice.mode === "future";

  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-neutral-400">
        {t("addDialog.seasons")}
      </p>
      <div
        role="group"
        aria-label={t("addDialog.seasons")}
        className="mb-2.5 flex flex-wrap gap-1.5"
      >
        {SEASON_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={choice.mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "focus-ring rounded-full border px-[13px] py-1.5 text-sm transition-colors",
              choice.mode === m
                ? "border-primary-400 bg-primary-400 font-semibold text-neutral-950"
                : "border-border text-neutral-100 hover:border-border-strong",
            )}
          >
            {t(`addDialog.modes.${m}`)}
          </button>
        ))}
      </div>
      <SeasonStrip
        seasons={seasons}
        choice={choice}
        onTogglePick={choice.mode === "pick" ? togglePick : undefined}
      />
      <SeasonSummary seasons={seasons} choice={choice} />
      {showNewSeasons && (
        <ToggleRow
          className="mt-1.5"
          title={t("addDialog.newSeasons")}
          hint={newSeasonsHint ?? t("addDialog.newSeasonsHint")}
          checked={forced || choice.newSeasons}
          disabled={forced}
          onChange={(v) => onChange({ ...choice, newSeasons: v })}
        />
      )}
    </div>
  );
}

export function ToggleRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
  className,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4 py-2.5", className)}
    >
      <div>
        <div className="font-medium text-neutral-50">{title}</div>
        {hint && <div className="text-[13px] text-neutral-400">{hint}</div>}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={title}
        className="mt-0.5"
      />
    </div>
  );
}
