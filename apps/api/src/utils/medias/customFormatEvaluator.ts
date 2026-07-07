// apps/api/src/utils/medias/customFormatEvaluator.ts
import { parseAudioFlags } from "@rawkoon/api/utils/medias/filenameParser";
import type {
  AssignedCustomFormat,
  FormatCondition,
  ReleaseEvalContext,
} from "@rawkoon/api/utils/medias/customFormatTypes";

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numericCompare(
  op: FormatCondition["operator"],
  actual: number,
  value: FormatCondition["value"],
): boolean {
  if (op === "between") {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const min = asNumber(value[0]);
    const max = asNumber(value[1]);
    if (min == null || max == null) return false;
    return actual >= min && actual <= max;
  }
  const target = asNumber(value);
  if (target == null) return false;
  switch (op) {
    case "gte":
      return actual >= target;
    case "lte":
      return actual <= target;
    case "lt":
      return actual < target;
    case "gt":
      return actual > target;
    case "equals":
      return actual === target;
    default:
      return false;
  }
}

function regexMatch(
  value: FormatCondition["value"],
  subject: string | null,
): boolean {
  if (typeof value !== "string" || subject == null) return false;
  try {
    return new RegExp(value, "i").test(subject);
  } catch {
    return false; // invalid regex never matches (and never throws)
  }
}

function stringEquals(
  value: FormatCondition["value"],
  subject: string | null,
): boolean {
  if (typeof value !== "string" || subject == null) return false;
  return value.trim().toLowerCase() === subject.trim().toLowerCase();
}

/** Evaluate a single condition (before negate is applied). */
function rawMatch(c: FormatCondition, ctx: ReleaseEvalContext): boolean {
  switch (c.type) {
    case "title_regex":
      return regexMatch(c.value, ctx.rawTitle);
    case "release_group":
      return regexMatch(c.value, ctx.parsed.group);
    case "source":
      return stringEquals(c.value, ctx.parsed.source);
    case "codec":
      return stringEquals(c.value, ctx.parsed.codec);
    case "indexer":
      return stringEquals(c.value, ctx.indexerName);
    case "resolution": {
      const res = ctx.parsed.resolution;
      if (res == null) return false;
      return numericCompare(c.operator, res, c.value);
    }
    // NOTE: language matching uses parseAudioFlags, which detects flags present
    // in the title (primarily French variants like VFF/VOSTFR/MULTI, plus explicit
    // ISO tags like "en"/"ENGLISH" when present). English-only releases often carry
    // no audio tag, so a bare { value: "en" } may not match. This mirrors the
    // existing scorer's preferredLanguages behavior — intentional, not a regression.
    case "language": {
      if (typeof c.value !== "string") return false;
      const flags = new Set(
        parseAudioFlags(ctx.rawTitle).map((f) => f.toLowerCase()),
      );
      return flags.has(c.value.trim().toLowerCase());
    }
    case "hdr_flag":
      return ctx.parsed.hdr != null;
    case "proper_repack":
      return ctx.parsed.isProper;
    case "freeleech":
      return ctx.freeleech;
    case "seeders": {
      if (ctx.seeders == null) return false;
      return numericCompare(c.operator, ctx.seeders, c.value);
    }
    case "size_range": {
      if (ctx.sizeBytes == null) return false;
      const gb = ctx.sizeBytes / 1e9;
      return numericCompare(c.operator, gb, c.value);
    }
    default:
      return false;
  }
}

export function conditionMatches(
  c: FormatCondition,
  ctx: ReleaseEvalContext,
): boolean {
  const r = rawMatch(c, ctx);
  return c.negate ? !r : r;
}

/** A format matches when it has at least one condition and ALL conditions match. */
export function formatMatches(
  format: AssignedCustomFormat,
  ctx: ReleaseEvalContext,
): boolean {
  if (!format.conditions.length) return false;
  return format.conditions.every((c) => conditionMatches(c, ctx));
}
