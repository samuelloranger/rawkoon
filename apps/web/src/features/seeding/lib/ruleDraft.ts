import type { SeedRule } from "@rawkoon/shared/types";

type T = (key: string, opts?: Record<string, unknown>) => string;
type TimeUnit = "hours" | "days";
export interface RuleDraft {
  ratio: string;
  time: string;
  unit: TimeUnit;
}

export function draftFromRule(rule: SeedRule): RuleDraft {
  const mins = rule.seed_time_mins;
  const days = mins != null && mins % 1440 === 0;
  return {
    ratio: rule.ratio == null ? "" : String(rule.ratio),
    time: mins == null ? "" : String(days ? mins / 1440 : mins / 60),
    unit: mins == null || days ? "days" : "hours",
  };
}

const parse = (raw: string): number | null | undefined => {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function ruleFromDraft(draft: RuleDraft): SeedRule | null {
  const ratio = parse(draft.ratio);
  const time = parse(draft.time);
  if (ratio === undefined || time === undefined) return null;
  return {
    ratio,
    seed_time_mins:
      time == null
        ? null
        : Math.round(time * (draft.unit === "days" ? 1440 : 60)),
  };
}

function formatTargetTime(mins: number, t: T): string {
  return mins % 1440 === 0
    ? t("settings.seeding.days", { count: mins / 1440 })
    : t("settings.seeding.hours", { count: Math.round((mins / 60) * 10) / 10 });
}

export function ruleSentence(rule: SeedRule, t: T): string {
  const ratio = rule.ratio == null ? null : rule.ratio.toFixed(1);
  const time =
    rule.seed_time_mins == null
      ? null
      : formatTargetTime(rule.seed_time_mins, t);
  if (ratio && time)
    return t("settings.seeding.sentence.both", { ratio, time });
  if (ratio) return t("settings.seeding.sentence.ratio", { ratio });
  if (time) return t("settings.seeding.sentence.time", { time });
  return t("settings.seeding.sentence.none");
}
