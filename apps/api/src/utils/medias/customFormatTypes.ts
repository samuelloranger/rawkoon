// apps/api/src/utils/medias/customFormatTypes.ts
import type { ParsedRelease } from "@rawkoon/api/utils/medias/filenameParser";

/** Condition dimensions — all derivable from existing parse/release data. */
export type ConditionType =
  | "title_regex"
  | "release_group"
  | "source"
  | "resolution"
  | "codec"
  | "language"
  | "hdr_flag"
  | "proper_repack"
  | "size_range"
  | "indexer"
  | "freeleech"
  | "seeders";

export type ConditionOperator =
  | "matches" // regex: title_regex, release_group
  | "equals" // source, codec, resolution, indexer, language
  | "gte"
  | "lte"
  | "lt"
  | "gt" // seeders, resolution
  | "between" // size_range (GB), seeders
  | "is_true"; // hdr_flag, proper_repack, freeleech

export interface FormatCondition {
  type: ConditionType;
  operator: ConditionOperator;
  /** string for regex/equals, number for numeric ops, [min,max] for between. */
  value?: string | number | [number, number];
  /** Invert this single condition's result. */
  negate?: boolean;
}

/** A custom format as it applies within one quality profile. */
export interface AssignedCustomFormat {
  name: string;
  conditions: FormatCondition[];
  score: number;
  required: boolean;
  forbidden: boolean;
}

/** Everything a condition can be evaluated against. */
export interface ReleaseEvalContext {
  parsed: ParsedRelease;
  rawTitle: string;
  sizeBytes: number | null;
  indexerName: string | null;
  seeders: number | null;
  freeleech: boolean;
}

/** Rejection reason as a stable code + interpolation params (NEVER localized prose). */
export interface RejectionReason {
  code: string;
  params?: Record<string, string | number>;
}

export type ScoreComponentCode =
  | "resolution_tier"
  | "preferred_source"
  | "preferred_codec"
  | "language_match"
  | "prefer_hdr"
  | "proper_repack"
  | "freeleech"
  | "tracker_priority"
  | "size_penalty"
  | "custom_format";

export interface ScoreComponent {
  code: ScoreComponentCode;
  value: number;
  params?: Record<string, string | number>;
}

export type ScoreBreakdown =
  | { rejected: true; reasons: RejectionReason[] }
  | {
      rejected: false;
      total: number;
      components: ScoreComponent[];
      matchedFormats: string[];
    };
