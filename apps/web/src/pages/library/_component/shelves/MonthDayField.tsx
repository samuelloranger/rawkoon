import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MONTHS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
] as const;

const DAYS = Array.from({ length: 31 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);

/**
 * A month and a day, kept as the server's `MM-DD`. Empty means "no bound":
 * a window with neither shows the shelf all year, and one with a single bound
 * runs from (or to) that day.
 */
export function MonthDayField({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
}) {
  const { t, i18n } = useTranslation("common");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const month = value?.slice(0, 2) ?? "";
  const day = value?.slice(3, 5) ?? "";
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { month: "long" }).format(
          new Date(2024, i, 1),
        ),
      ),
    [locale],
  );

  const update = (nextMonth: string, nextDay: string) => {
    if (!nextMonth && !nextDay) return onChange(null);
    onChange(`${nextMonth || "01"}-${nextDay || "01"}`);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-neutral-400">{label}</p>
      <div className="flex gap-2">
        <Select
          value={month || "none"}
          onValueChange={(next) => update(next === "none" ? "" : next, day)}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder={t("shelves.anyMonth")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("shelves.anyMonth")}</SelectItem>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={m}>
                {monthNames[i]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={day || "none"}
          onValueChange={(next) => update(month, next === "none" ? "" : next)}
        >
          <SelectTrigger className="h-9 w-24">
            <SelectValue placeholder={t("shelves.anyDay")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("shelves.anyDay")}</SelectItem>
            {DAYS.map((d) => (
              <SelectItem key={d} value={d}>
                {Number(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
