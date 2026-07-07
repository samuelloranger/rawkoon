import { useTranslation } from "react-i18next";
import { Check, Plus, Trash2 } from "lucide-react";
import type {
  CustomFormatCondition,
  ConditionType,
  ConditionOperator,
} from "@rawkoon/shared/types";
import {
  CONDITION_TYPE_KEYS,
  OPERATOR_KEYS,
  codeKey,
} from "@/lib/i18n/scoringCodes";
import { cn } from "@/lib/utils";

// ─── Operator map (mirrors backend allowedOperators) ──────────────────────────

const ALLOWED_OPERATORS: Record<ConditionType, ConditionOperator[]> = {
  title_regex: ["matches"],
  release_group: ["matches"],
  source: ["equals"],
  codec: ["equals"],
  indexer: ["equals"],
  language: ["equals"],
  hdr_flag: ["is_true"],
  proper_repack: ["is_true"],
  freeleech: ["is_true"],
  resolution: ["gte", "lte", "lt", "gt", "equals", "between"],
  seeders: ["gte", "lte", "lt", "gt", "equals", "between"],
  size_range: ["gte", "lte", "lt", "gt", "equals", "between"],
};

const ALL_CONDITION_TYPES = Object.keys(CONDITION_TYPE_KEYS) as ConditionType[];

// ─── Default values when switching type/operator ─────────────────────────────

function defaultValueForOperator(
  op: ConditionOperator,
): CustomFormatCondition["value"] {
  if (op === "is_true") return undefined;
  if (op === "between") return [0, 0];
  return "";
}

function defaultValueForType(
  type: ConditionType,
): CustomFormatCondition["value"] {
  const op = ALLOWED_OPERATORS[type][0];
  return defaultValueForOperator(op);
}

// ─── Styling constants (mirrors QualityProfileForm.tsx) ──────────────────────

const selectClass =
  "w-full rounded-lg border px-3 py-2 text-sm border-neutral-700 bg-neutral-900 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-colors";

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm border-neutral-700 bg-neutral-900 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-colors";

// ─── Regex validity check ─────────────────────────────────────────────────────

function isValidRegex(pattern: string): boolean {
  if (!pattern) return true;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// ─── Single condition row ─────────────────────────────────────────────────────

interface ConditionRowProps {
  condition: CustomFormatCondition;
  onChange: (next: CustomFormatCondition) => void;
  onRemove: () => void;
}

function ConditionRow({ condition, onChange, onRemove }: ConditionRowProps) {
  const { t } = useTranslation("common");
  const { type, operator, value, negate } = condition;

  const allowedOps = ALLOWED_OPERATORS[type];
  const isRegexType = type === "title_regex" || type === "release_group";
  const showRegexError =
    isRegexType &&
    operator === "matches" &&
    typeof value === "string" &&
    !isValidRegex(value);

  // ── handlers ──

  const handleTypeChange = (newType: ConditionType) => {
    const firstOp = ALLOWED_OPERATORS[newType][0];
    onChange({
      ...condition,
      type: newType,
      operator: firstOp,
      value: defaultValueForType(newType),
    });
  };

  const handleOperatorChange = (newOp: ConditionOperator) => {
    let nextValue: CustomFormatCondition["value"];
    if (newOp === "is_true") {
      nextValue = undefined;
    } else if (newOp === "between") {
      // Convert existing numeric value to [n, n]
      const n = typeof value === "number" ? value : 0;
      nextValue = [n, n];
    } else {
      // Switching away from between: take first element if was [min, max]
      if (operator === "between" && Array.isArray(value)) {
        nextValue = value[0];
      } else if (operator === "is_true") {
        // Switching from is_true to a string/numeric op
        const isNumericType =
          type === "resolution" || type === "seeders" || type === "size_range";
        nextValue = isNumericType ? 0 : "";
      } else {
        nextValue = value;
      }
    }
    onChange({ ...condition, operator: newOp, value: nextValue });
  };

  const handleSingleValueChange = (raw: string) => {
    const isNumericOp =
      operator === "gte" ||
      operator === "lte" ||
      operator === "lt" ||
      operator === "gt" ||
      operator === "equals";
    const isNumericType =
      type === "resolution" || type === "seeders" || type === "size_range";
    const numericContext = isNumericOp && isNumericType;
    onChange({
      ...condition,
      value: numericContext ? (raw === "" ? 0 : Number(raw)) : raw,
    });
  };

  const handleBetweenChange = (idx: 0 | 1, raw: string) => {
    const pair = Array.isArray(value)
      ? ([...value] as [number, number])
      : [0, 0];
    pair[idx] = raw === "" ? 0 : Number(raw);
    onChange({ ...condition, value: pair as [number, number] });
  };

  const handleNegateChange = (checked: boolean) => {
    onChange({ ...condition, negate: checked });
  };

  // ── value input ──

  const renderValueInput = () => {
    if (operator === "is_true") {
      return null;
    }

    if (operator === "between") {
      const [min, max] = Array.isArray(value) ? value : [0, 0];
      return (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={min}
            onChange={(e) => handleBetweenChange(0, e.target.value)}
            className={cn(inputClass, "min-w-0")}
            aria-label="min"
          />
          <span className="text-xs text-neutral-400 shrink-0">–</span>
          <input
            type="number"
            value={max}
            onChange={(e) => handleBetweenChange(1, e.target.value)}
            className={cn(inputClass, "min-w-0")}
            aria-label="max"
          />
        </div>
      );
    }

    const isNumericType =
      type === "resolution" || type === "seeders" || type === "size_range";

    if (isNumericType) {
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : 0}
          onChange={(e) => handleSingleValueChange(e.target.value)}
          className={inputClass}
        />
      );
    }

    // String / regex input
    return (
      <div className="relative flex-1">
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => handleSingleValueChange(e.target.value)}
          className={cn(
            inputClass,
            showRegexError && "border-red-500 focus:ring-red-500/30",
          )}
          spellCheck={false}
        />
        {isRegexType && typeof value === "string" && value.length > 0 && (
          <span
            className={cn(
              "absolute right-2.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full",
              showRegexError ? "bg-red-500" : "bg-emerald-500",
            )}
            aria-label={showRegexError ? "invalid regex" : "valid regex"}
          />
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 border-neutral-700 bg-neutral-800/40">
      {/* Row 1: type + operator + value */}
      <div className="flex items-start gap-2">
        {/* Type select */}
        <div className="flex-[0_0_auto] w-36">
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as ConditionType)}
            className={selectClass}
            aria-label="condition type"
          >
            {ALL_CONDITION_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {t(codeKey(CONDITION_TYPE_KEYS, ct))}
              </option>
            ))}
          </select>
        </div>

        {/* Operator select */}
        <div className="flex-[0_0_auto] w-28">
          <select
            value={operator}
            onChange={(e) =>
              handleOperatorChange(e.target.value as ConditionOperator)
            }
            className={selectClass}
            disabled={allowedOps.length === 1}
            aria-label="condition operator"
          >
            {allowedOps.map((op) => (
              <option key={op} value={op}>
                {t(codeKey(OPERATOR_KEYS, op))}
              </option>
            ))}
          </select>
        </div>

        {/* Value input(s) */}
        <div className="flex-1 min-w-0">
          {renderValueInput() ?? (
            <div className="h-[38px] flex items-center px-3 text-xs text-neutral-500 rounded-lg border border-dashed border-neutral-700">
              {/* no value needed */}
            </div>
          )}
        </div>

        {/* Remove button */}
        <button
          type="button"
          onClick={onRemove}
          className="flex-shrink-0 mt-0.5 flex h-[38px] w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-700 hover:text-red-400 transition-colors"
          aria-label="remove condition"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Row 2: Negate toggle */}
      <div className="pl-0.5">
        <label className="flex items-center gap-2 cursor-pointer select-none group w-fit">
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded border transition-colors",
              negate
                ? "text-white border-primary-400 bg-primary-400"
                : "border-neutral-600 group-hover:border-neutral-400",
            )}
          >
            {negate && <Check size={10} strokeWidth={3} />}
          </span>
          <input
            type="checkbox"
            className="sr-only"
            checked={!!negate}
            onChange={(e) => handleNegateChange(e.target.checked)}
            aria-label={t("customFormats.negate")}
          />
          <span className="text-xs text-neutral-400">
            {t("customFormats.negate")}
          </span>
        </label>
      </div>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface ConditionBuilderProps {
  conditions: CustomFormatCondition[];
  onChange: (next: CustomFormatCondition[]) => void;
}

export function ConditionBuilder({
  conditions,
  onChange,
}: ConditionBuilderProps) {
  const { t } = useTranslation("common");

  const handleConditionChange = (idx: number, next: CustomFormatCondition) => {
    const updated = conditions.map((c, i) => (i === idx ? next : c));
    onChange(updated);
  };

  const handleRemove = (idx: number) => {
    onChange(conditions.filter((_, i) => i !== idx));
  };

  const handleAdd = () => {
    onChange([
      ...conditions,
      { type: "title_regex", operator: "matches", value: "" },
    ]);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Group header */}
      {conditions.length > 0 && (
        <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
          {t("customFormats.allOf")}
        </p>
      )}

      {/* Condition rows */}
      {conditions.map((condition, idx) => (
        <ConditionRow
          key={idx}
          condition={condition}
          onChange={(next) => handleConditionChange(idx, next)}
          onRemove={() => handleRemove(idx)}
        />
      ))}

      {/* Add condition button */}
      <button
        type="button"
        onClick={handleAdd}
        className="flex items-center gap-1.5 self-start rounded-lg border border-dashed px-3 py-2 text-sm border-neutral-600 text-neutral-400 hover:border-neutral-500 hover:text-neutral-300 transition-colors"
      >
        <Plus size={14} />
        {t("customFormats.addCondition")}
      </button>
    </div>
  );
}
