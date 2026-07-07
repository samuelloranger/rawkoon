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
  | "matches"
  | "equals"
  | "gte"
  | "lte"
  | "lt"
  | "gt"
  | "between"
  | "is_true";

export interface CustomFormatCondition {
  type: ConditionType;
  operator: ConditionOperator;
  value?: string | number | [number, number];
  negate?: boolean;
}

export interface CustomFormat {
  id: number;
  name: string;
  conditions: CustomFormatCondition[];
  created_at: string;
  updated_at: string;
}

export interface CustomFormatsListResponse {
  custom_formats: CustomFormat[];
}

export interface QualityProfileCustomFormatAssignment {
  custom_format_id: number;
  name?: string;
  score: number;
  required: boolean;
  forbidden: boolean;
}
