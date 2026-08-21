import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Typography } from "./types";

const FONT_SIZES = [15, 17, 19, 21, 24, 28];
const LINE_HEIGHTS = [1.3, 1.45, 1.65, 1.85, 2.1];
const MARGINS = [8, 16, 24, 32, 48, 64, 96];

/** Moves one step through a list of allowed values. */
const step = <T,>(values: T[], current: T, direction: -1 | 1): T => {
  const index = values.indexOf(current);
  const from = index === -1 ? 0 : index;
  return values[Math.min(values.length - 1, Math.max(0, from + direction))];
};

/**
 * Typography controls. Only shown for epub — a pdf and a cbz have a fixed
 * layout, and offering dead controls is worse than offering none.
 */
export const ReaderSettings = ({
  typography,
  onChange,
  background,
}: {
  typography: Typography;
  onChange: (next: Typography) => void;
  background: string;
}) => {
  const { t } = useTranslation("common");

  const Row = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs uppercase tracking-wide opacity-60">
        {label}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );

  /**
   * A minus/value/plus control. Replaces a range input: on a phone a slider is
   * a poor fit — it needs a precise drag inside a narrow drawer, and it gives no
   * indication of the value it will land on.
   */
  const Stepper = ({
    label,
    value,
    atMin,
    atMax,
    onStep,
  }: {
    label: string;
    value: string;
    atMin: boolean;
    atMax: boolean;
    onStep: (direction: -1 | 1) => void;
  }) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs uppercase tracking-wide opacity-60">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={atMin}
          aria-label={t("books.reader.decrease", { label })}
          className="focus-ring flex size-8 items-center justify-center rounded-md border border-current/20 text-base disabled:opacity-30"
        >
          <Minus className="size-4" />
        </button>
        <span className="w-14 text-center font-mono text-xs tabular-nums">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={atMax}
          aria-label={t("books.reader.increase", { label })}
          className="focus-ring flex size-8 items-center justify-center rounded-md border border-current/20 text-base disabled:opacity-30"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );

  const Choice = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "focus-ring rounded-md border px-2 py-1 text-xs",
        active
          ? "border-primary-500 text-primary-400"
          : "border-current/20 opacity-70 hover:opacity-100",
      )}
    >
      {children}
    </button>
  );

  return (
    <div
      className="absolute inset-y-0 right-0 z-20 w-72 max-w-[80vw] overflow-y-auto border-l border-border/40 p-4"
      style={{ background }}
      role="group"
      aria-label={t("books.reader.typography")}
    >
      <Row label={t("books.reader.theme")}>
        <Choice
          active={typography.theme === "night"}
          onClick={() => onChange({ ...typography, theme: "night" })}
        >
          {t("books.reader.themeNight")}
        </Choice>
        <Choice
          active={typography.theme === "paper"}
          onClick={() => onChange({ ...typography, theme: "paper" })}
        >
          {t("books.reader.themePaper")}
        </Choice>
      </Row>

      <Row label={t("books.reader.typeface")}>
        <Choice
          active={typography.fontFamily === "serif"}
          onClick={() => onChange({ ...typography, fontFamily: "serif" })}
        >
          Literata
        </Choice>
        <Choice
          active={typography.fontFamily === "sans"}
          onClick={() => onChange({ ...typography, fontFamily: "sans" })}
        >
          Hanken
        </Choice>
      </Row>

      <Stepper
        label={t("books.reader.textSize")}
        value={`${typography.fontSizePx}px`}
        atMin={typography.fontSizePx === FONT_SIZES[0]}
        atMax={typography.fontSizePx === FONT_SIZES[FONT_SIZES.length - 1]}
        onStep={(direction) =>
          onChange({
            ...typography,
            fontSizePx: step(FONT_SIZES, typography.fontSizePx, direction),
          })
        }
      />

      <Stepper
        label={t("books.reader.lineHeight")}
        value={typography.lineHeight.toFixed(2)}
        atMin={typography.lineHeight <= LINE_HEIGHTS[0]}
        atMax={typography.lineHeight >= LINE_HEIGHTS[LINE_HEIGHTS.length - 1]}
        onStep={(direction) =>
          onChange({
            ...typography,
            lineHeight: step(LINE_HEIGHTS, typography.lineHeight, direction),
          })
        }
      />

      <Stepper
        label={t("books.reader.margins")}
        value={`${typography.marginPx}px`}
        atMin={typography.marginPx <= MARGINS[0]}
        atMax={typography.marginPx >= MARGINS[MARGINS.length - 1]}
        onStep={(direction) =>
          onChange({
            ...typography,
            marginPx: step(MARGINS, typography.marginPx, direction),
          })
        }
      />

      <Row label={t("books.reader.flow")}>
        <Choice
          active={typography.flow === "paginated"}
          onClick={() => onChange({ ...typography, flow: "paginated" })}
        >
          {t("books.reader.flowPaginated")}
        </Choice>
        <Choice
          active={typography.flow === "scrolled"}
          onClick={() => onChange({ ...typography, flow: "scrolled" })}
        >
          {t("books.reader.flowScrolled")}
        </Choice>
      </Row>
    </div>
  );
};
