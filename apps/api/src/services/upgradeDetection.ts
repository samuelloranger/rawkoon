import {
  scoreRelease,
  type QualityProfileScoreInput,
} from "@rawkoon/api/utils/medias/releaseScorer";
import type { ParsedRelease } from "@rawkoon/api/utils/medias/filenameParser";
import type {
  AssignedCustomFormat,
  ConditionType,
} from "@rawkoon/api/utils/medias/customFormatTypes";

export type MediaFileRow = {
  resolution: number | null;
  source: string | null;
  videoCodec: string | null;
  hdrFormat: string | null;
  sizeBytes: bigint | null;
  languageTags: string[];
  releaseGroup?: string | null;
};

/**
 * Condition types that can be evaluated from a local MediaFile. Release-only
 * signals are NOT observable on a downloaded file, so custom formats that
 * reference them are skipped during file-based upgrade checks:
 *   - indexer / freeleech / seeders: properties of the release, not the file
 *   - title_regex: the file has no original release title (only language tags)
 *   - proper_repack: the PROPER/REPACK flag isn't stored per file
 * Without this, a `required` format on any such field would always evaluate as
 * absent and spuriously report already-valid downloads as needing an upgrade.
 */
const FILE_OBSERVABLE_CONDITIONS: ReadonlySet<ConditionType> =
  new Set<ConditionType>([
    "resolution",
    "source",
    "codec",
    "hdr_flag",
    "size_range",
    "language",
    "release_group",
  ]);

function isFileObservableFormat(fmt: AssignedCustomFormat): boolean {
  return fmt.conditions.every((c) => FILE_OBSERVABLE_CONDITIONS.has(c.type));
}

/**
 * Returns true if any MediaFile row fails the given quality profile.
 * Empty array → false (nothing downloaded = nothing to upgrade).
 *
 * Files are scored against a file-safe variant of the profile: the seeders gate
 * is disabled and custom formats referencing release-only fields are dropped, so
 * release-selection rules can't falsely flag a valid local file (see
 * FILE_OBSERVABLE_CONDITIONS).
 */
export function filesFailProfile(
  files: MediaFileRow[],
  profile: QualityProfileScoreInput,
): boolean {
  if (files.length === 0) return false;

  const fileSafeProfile: QualityProfileScoreInput = {
    ...profile,
    minSeeders: 0,
    customFormats: profile.customFormats.filter(isFileObservableFormat),
  };

  for (const f of files) {
    const parsed: ParsedRelease = {
      resolution: f.resolution as 480 | 720 | 1080 | 2160 | null,
      source: f.source,
      codec: f.videoCodec,
      hdr: f.hdrFormat,
      audio: null,
      group: f.releaseGroup ?? null,
      streaming: null,
      isSample: false,
      isProper: false,
    };

    const sizeNum = f.sizeBytes != null ? Number(f.sizeBytes) : null;
    const langString = f.languageTags.join(" ");

    const result = scoreRelease(
      parsed,
      fileSafeProfile,
      sizeNum,
      langString,
      null,
      false,
      null,
    );

    if (Array.isArray(result)) return true;
  }

  return false;
}
