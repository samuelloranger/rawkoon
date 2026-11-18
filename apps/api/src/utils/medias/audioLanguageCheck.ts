import {
  classifyLanguageTags,
  languageFamilyOf,
  trackLanguageFamily,
  type LibraryAudioTrack,
} from "@rawkoon/shared";

export type AudioLanguageCheck =
  | { status: "skip" | "ok" }
  | { status: "mismatch" | "warn"; fileLanguages: string[] };

const VFQ_TITLE = /vfq|vqc|qu[eé]bec|canad/i;
const VFF_TITLE = /vff|france|truefrench|europ/i;

type Track = Pick<LibraryAudioTrack, "language" | "title">;

// Falls back to the track title for tags like und, via the shared track classifier.
function familyOf(t: Track): string | null {
  const direct = trackLanguageFamily(t.language);
  if (direct) return direct;
  const tag = classifyLanguageTags([t as LibraryAudioTrack])[0];
  return tag ? languageFamilyOf(tag) : null;
}

function isVfq(t: Track): boolean {
  return /^vfq$|fr[-_]ca/i.test(t.language) || VFQ_TITLE.test(t.title ?? "");
}

function isFranceFrench(t: Track): boolean {
  return /^vff$|fr[-_]fr/i.test(t.language) || VFF_TITLE.test(t.title ?? "");
}

/**
 * Compare a file's audio tracks with a profile's preferred languages by family.
 * "warn" means French audio is present but only France-French evidence exists
 * while the profile asks for VFQ.
 */
export function checkAudioLanguages(
  tracks: readonly Track[],
  preferred: readonly string[],
): AudioLanguageCheck {
  const wanted = new Set(
    preferred.map(languageFamilyOf).filter((f): f is string => f != null),
  );
  if (wanted.size === 0) return { status: "skip" };

  const determined = tracks.filter((t) => familyOf(t));
  if (determined.length === 0) return { status: "skip" };

  const fileLanguages = [
    ...new Set(determined.map((t) => t.language.toLowerCase())),
  ];
  const matching = determined.filter((t) => wanted.has(familyOf(t)!));
  if (matching.length === 0) {
    // An undetermined or unmappable track may be the preferred audio: inconclusive.
    if (determined.length < tracks.length) return { status: "skip" };
    return { status: "mismatch", fileLanguages };
  }

  const lower = preferred.map((p) => p.toLowerCase());
  const onlyVfq =
    lower.includes("vfq") &&
    !lower.some((p) =>
      ["vff", "vfi", "vf2", "vf", "fr", "french", "truefrench"].includes(p),
    );
  if (onlyVfq && !matching.some(isVfq) && matching.some(isFranceFrench)) {
    return { status: "warn", fileLanguages };
  }
  return { status: "ok" };
}
