export const REJECTION_CODE_KEYS: Record<string, string> = {
  resolution_below_min: "scoring.reject.resolutionBelowMin",
  resolution_above_cutoff: "scoring.reject.resolutionAboveCutoff",
  hdr_required_absent: "scoring.reject.hdrRequiredAbsent",
  language_no_match: "scoring.reject.languageNoMatch",
  size_over_cap: "scoring.reject.sizeOverCap",
  is_sample: "scoring.reject.isSample",
  seeders_below_min: "scoring.reject.seedersBelowMin",
  custom_format_required_absent: "scoring.reject.customFormatRequiredAbsent",
  custom_format_forbidden_present:
    "scoring.reject.customFormatForbiddenPresent",
};

export const COMPONENT_CODE_KEYS: Record<string, string> = {
  resolution_tier: "scoring.component.resolutionTier",
  preferred_source: "scoring.component.preferredSource",
  preferred_codec: "scoring.component.preferredCodec",
  language_match: "scoring.component.languageMatch",
  prefer_hdr: "scoring.component.preferHdr",
  proper_repack: "scoring.component.properRepack",
  freeleech: "scoring.component.freeleech",
  tracker_priority: "scoring.component.trackerPriority",
  size_penalty: "scoring.component.sizePenalty",
  custom_format: "scoring.component.customFormat",
};

export const CONDITION_TYPE_KEYS: Record<string, string> = {
  title_regex: "customFormats.condition.titleRegex",
  release_group: "customFormats.condition.releaseGroup",
  source: "customFormats.condition.source",
  resolution: "customFormats.condition.resolution",
  codec: "customFormats.condition.codec",
  language: "customFormats.condition.language",
  hdr_flag: "customFormats.condition.hdrFlag",
  proper_repack: "customFormats.condition.properRepack",
  size_range: "customFormats.condition.sizeRange",
  indexer: "customFormats.condition.indexer",
  freeleech: "customFormats.condition.freeleech",
  seeders: "customFormats.condition.seeders",
};

export const OPERATOR_KEYS: Record<string, string> = {
  matches: "customFormats.operator.matches",
  equals: "customFormats.operator.equals",
  gte: "customFormats.operator.gte",
  lte: "customFormats.operator.lte",
  lt: "customFormats.operator.lt",
  gt: "customFormats.operator.gt",
  between: "customFormats.operator.between",
  is_true: "customFormats.operator.isTrue",
};

export const VALIDATION_CODE_KEYS: Record<string, string> = {
  conditions_not_array: "customFormats.error.conditionsNotArray",
  conditions_empty: "customFormats.error.conditionsEmpty",
  condition_not_object: "customFormats.error.conditionNotObject",
  condition_type_invalid: "customFormats.error.conditionTypeInvalid",
  operator_invalid_for_type: "customFormats.error.operatorInvalidForType",
  negate_invalid: "customFormats.error.negateInvalid",
  value_invalid_for_operator: "customFormats.error.valueInvalidForOperator",
  regex_invalid: "customFormats.error.regexInvalid",
  unknown_custom_format_id: "customFormats.error.unknownCustomFormatId",
};

export function codeKey(map: Record<string, string>, code: string): string {
  return map[code] ?? code;
}
