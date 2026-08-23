import type { BookFormat, BookQualityProfile } from "@rawkoon/shared/types";
import {
  bookFormatsForKind,
  validateBookProfileFormats,
  type BookProfileKind,
} from "@rawkoon/shared/utils";
import type { BookQualityProfileBody } from "@/pages/books/_hooks/useBooks";

/**
 * Form state for a book quality profile.
 *
 * Numbers are held as raw strings so a half-typed value never collapses to 0,
 * and are only coerced on submit.
 */
export interface BookProfileDraftState {
  name: string;
  kind: BookProfileKind;
  /** Ordered preference; first entry is best. */
  allowedFormats: BookFormat[];
  cutoffFormat: BookFormat | null;
  preferRetail: boolean;
  maxSizeMb: string;
  minSeeders: string;
  minAudioBitrate: string;
  preferredLanguages: string[];
  prioritizedTrackers: string[];
  preferTrackerOverQuality: boolean;
}

export function emptyBookProfileDraft(): BookProfileDraftState {
  return {
    name: "",
    kind: "ebook",
    allowedFormats: ["epub"],
    cutoffFormat: null,
    preferRetail: true,
    maxSizeMb: "",
    minSeeders: "0",
    minAudioBitrate: "",
    preferredLanguages: [],
    prioritizedTrackers: [],
    preferTrackerOverQuality: false,
  };
}

export function bookProfileToDraft(
  profile: BookQualityProfile,
): BookProfileDraftState {
  return {
    name: profile.name,
    kind: profile.kind,
    allowedFormats: [...profile.allowed_formats],
    cutoffFormat: profile.cutoff_format,
    preferRetail: profile.prefer_retail,
    maxSizeMb: profile.max_size_mb != null ? String(profile.max_size_mb) : "",
    minSeeders: String(profile.min_seeders),
    minAudioBitrate:
      profile.min_audio_bitrate != null
        ? String(profile.min_audio_bitrate)
        : "",
    preferredLanguages: [...profile.preferred_languages],
    prioritizedTrackers: [...profile.prioritized_trackers],
    preferTrackerOverQuality: profile.prefer_tracker_over_quality,
  };
}

/**
 * Switching kind drops formats that belong to the other kind, and the cutoff
 * with them if it was one of the dropped ones. Without this, changing an ebook
 * profile to audiobook would submit an epub the API refuses.
 */
export function pruneDraftForKind(
  draft: BookProfileDraftState,
  kind: BookProfileKind,
): BookProfileDraftState {
  const allowed = bookFormatsForKind(kind);
  const allowedFormats = draft.allowedFormats.filter((f) =>
    allowed.includes(f),
  );
  return {
    ...draft,
    kind,
    allowedFormats,
    cutoffFormat:
      draft.cutoffFormat && allowedFormats.includes(draft.cutoffFormat)
        ? draft.cutoffFormat
        : null,
    // An ebook profile has no bitrate floor to enforce.
    minAudioBitrate: kind === "ebook" ? "" : draft.minAudioBitrate,
  };
}

/** Toggle a format, keeping click order as preference order. */
export function toggleFormat(
  draft: BookProfileDraftState,
  format: BookFormat,
): BookProfileDraftState {
  if (draft.allowedFormats.includes(format)) {
    const allowedFormats = draft.allowedFormats.filter((f) => f !== format);
    return {
      ...draft,
      allowedFormats,
      cutoffFormat: draft.cutoffFormat === format ? null : draft.cutoffFormat,
    };
  }
  return { ...draft, allowedFormats: [...draft.allowedFormats, format] };
}

/** Move a format one place towards the front (better) or back (worse). */
export function moveFormat(
  draft: BookProfileDraftState,
  from: number,
  to: number,
): BookProfileDraftState {
  if (to < 0 || to >= draft.allowedFormats.length) return draft;
  const allowedFormats = [...draft.allowedFormats];
  const [moved] = allowedFormats.splice(from, 1);
  if (!moved) return draft;
  allowedFormats.splice(to, 0, moved);
  return { ...draft, allowedFormats };
}

export type BookProfileDraftError =
  | { code: "name_required" }
  | { code: "formats_required" }
  | { code: "invalid"; message: string };

export function validateBookProfileDraft(
  draft: BookProfileDraftState,
): BookProfileDraftError | null {
  if (!draft.name.trim()) return { code: "name_required" };
  if (draft.allowedFormats.length === 0) return { code: "formats_required" };

  const message = validateBookProfileFormats(
    draft.kind,
    draft.allowedFormats,
    draft.cutoffFormat,
  );
  return message ? { code: "invalid", message } : null;
}

/** "" means "no limit" for the nullable numbers, and 0 for the seeder floor. */
const optionalNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export function bookProfileDraftToBody(
  draft: BookProfileDraftState,
): BookQualityProfileBody {
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    allowed_formats: draft.allowedFormats,
    cutoff_format: draft.cutoffFormat,
    prefer_retail: draft.preferRetail,
    max_size_mb: optionalNumber(draft.maxSizeMb),
    min_seeders: optionalNumber(draft.minSeeders) ?? 0,
    min_audio_bitrate:
      draft.kind === "ebook" ? null : optionalNumber(draft.minAudioBitrate),
    preferred_languages: draft.preferredLanguages,
    prioritized_trackers: draft.prioritizedTrackers,
    prefer_tracker_over_quality: draft.preferTrackerOverQuality,
  };
}
