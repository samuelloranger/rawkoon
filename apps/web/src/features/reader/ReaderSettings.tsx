import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Typography } from "./types";

const FONT_SIZES = [15, 17, 19, 21, 24, 28];

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

      <Row label={t("books.reader.textSize")}>
        <input
          type="range"
          min={0}
          max={FONT_SIZES.length - 1}
          value={Math.max(0, FONT_SIZES.indexOf(typography.fontSizePx))}
          onChange={(event) =>
            onChange({
              ...typography,
              fontSizePx: FONT_SIZES[Number(event.target.value)],
            })
          }
          className="focus-ring w-32 accent-primary-600"
          aria-label={t("books.reader.textSize")}
        />
      </Row>

      <Row label={t("books.reader.lineHeight")}>
        <input
          type="range"
          min={1.3}
          max={2.1}
          step={0.05}
          value={typography.lineHeight}
          onChange={(event) =>
            onChange({ ...typography, lineHeight: Number(event.target.value) })
          }
          className="focus-ring w-32 accent-primary-600"
          aria-label={t("books.reader.lineHeight")}
        />
      </Row>

      <Row label={t("books.reader.margins")}>
        <input
          type="range"
          min={8}
          max={96}
          step={8}
          value={typography.marginPx}
          onChange={(event) =>
            onChange({ ...typography, marginPx: Number(event.target.value) })
          }
          className="focus-ring w-32 accent-primary-600"
          aria-label={t("books.reader.margins")}
        />
      </Row>

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
