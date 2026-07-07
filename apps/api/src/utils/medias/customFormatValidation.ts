// apps/api/src/utils/medias/customFormatValidation.ts
import type {
  ConditionOperator,
  ConditionType,
  FormatCondition,
} from "@rawkoon/api/utils/medias/customFormatTypes";

const REGEX_TYPES = new Set<ConditionType>(["title_regex", "release_group"]);
const STRING_EQ_TYPES = new Set<ConditionType>([
  "source",
  "codec",
  "indexer",
  "language",
]);
const NUMERIC_TYPES = new Set<ConditionType>([
  "resolution",
  "seeders",
  "size_range",
]);
const BOOL_TYPES = new Set<ConditionType>([
  "hdr_flag",
  "proper_repack",
  "freeleech",
]);

const ALL_TYPES = new Set<ConditionType>([
  ...REGEX_TYPES,
  ...STRING_EQ_TYPES,
  ...NUMERIC_TYPES,
  ...BOOL_TYPES,
]);

const NUMERIC_OPS = new Set<ConditionOperator>([
  "gte",
  "lte",
  "lt",
  "gt",
  "equals",
  "between",
]);

type ValidationResult =
  | { ok: true; conditions: FormatCondition[] }
  | { ok: false; code: string };

function allowedOperators(type: ConditionType): Set<ConditionOperator> {
  if (REGEX_TYPES.has(type)) return new Set(["matches"]);
  if (STRING_EQ_TYPES.has(type)) return new Set(["equals"]);
  if (BOOL_TYPES.has(type)) return new Set(["is_true"]);
  return NUMERIC_OPS;
}

function valueOkForOperator(op: ConditionOperator, value: unknown): boolean {
  if (op === "is_true")
    return value === undefined || typeof value === "boolean";
  if (op === "matches" || op === "equals") {
    return typeof value === "string" || typeof value === "number";
  }
  if (op === "between") {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((v) => typeof v === "number" && Number.isFinite(v))
    );
  }
  return typeof value === "number" && Number.isFinite(value);
}

export function validateFormatConditions(value: unknown): ValidationResult {
  if (!Array.isArray(value)) return { ok: false, code: "conditions_not_array" };
  if (value.length === 0) return { ok: false, code: "conditions_empty" };

  for (const raw of value) {
    if (typeof raw !== "object" || raw == null)
      return { ok: false, code: "condition_not_object" };
    const c = raw as Partial<FormatCondition>;
    if (typeof c.type !== "string" || !ALL_TYPES.has(c.type as ConditionType)) {
      return { ok: false, code: "condition_type_invalid" };
    }
    if (typeof c.operator !== "string")
      return { ok: false, code: "operator_invalid_for_type" };
    if (
      !allowedOperators(c.type as ConditionType).has(
        c.operator as ConditionOperator,
      )
    ) {
      return { ok: false, code: "operator_invalid_for_type" };
    }
    if (c.negate !== undefined && typeof c.negate !== "boolean") {
      return { ok: false, code: "negate_invalid" };
    }
    if (!valueOkForOperator(c.operator as ConditionOperator, c.value)) {
      return { ok: false, code: "value_invalid_for_operator" };
    }
    if (c.operator === "matches" && typeof c.value === "string") {
      if (c.value.length > 100) {
        return { ok: false, code: "regex_too_long" };
      }
      // Reject basic nested quantifiers and overlapping wildcards to prevent ReDoS
      if (
        /\([^)]*[*+?][^)]*\)[*+?]/.test(c.value) ||
        /[*+][*+]/.test(c.value) ||
        /(\.\*){2,}/.test(c.value)
      ) {
        return { ok: false, code: "regex_unsafe" };
      }
      try {
        new RegExp(c.value);
      } catch {
        return { ok: false, code: "regex_invalid" };
      }
    }
  }
  return { ok: true, conditions: value as FormatCondition[] };
}
