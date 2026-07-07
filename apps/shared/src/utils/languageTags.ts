import type { LibraryAudioTrack } from "../types/library";

export type LanguageTag = string;

const EN_CODES = new Set(["en", "eng", "english"]);
const FR_CODES = new Set(["fr", "fre", "fra", "french"]);

const VFQ_KEYWORDS = [
  "vfq",
  "vqc",
  "truefrench",
  "queb",
  "quebec",
  "québec",
  "québécois",
  "quebecois",
  "canadien",
  "canadian",
  "canada",
  "fr-ca",
  "fr_ca",
  "frca",
];

const VFF_KEYWORDS = [
  "vff",
  "vf2",
  "parisian",
  "parisien",
  "european",
  "france",
  "fr-fr",
  "fr_fr",
  "frfr",
];

const VFI_KEYWORDS = ["vfi", "international"];

function normalize(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeLanguageCode(
  value: string | null | undefined,
): string {
  const normalized = normalize(value).trim();
  if (!normalized) return "";
  return normalized.split(/[^a-z]+/).find(Boolean) ?? "";
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function classifyFrenchTrack(
  trackTitle: string | null,
  releaseName: string | null,
): "VFQ" | "VFF" | "VFI" | "FR" {
  const trackHaystack = normalize(trackTitle);
  if (trackHaystack) {
    if (containsAny(trackHaystack, VFQ_KEYWORDS)) return "VFQ";
    if (containsAny(trackHaystack, VFF_KEYWORDS)) return "VFF";
    if (containsAny(trackHaystack, VFI_KEYWORDS)) return "VFI";
  }
  const releaseHaystack = normalize(releaseName);
  if (releaseHaystack) {
    if (containsAny(releaseHaystack, VFQ_KEYWORDS)) return "VFQ";
    if (containsAny(releaseHaystack, VFF_KEYWORDS)) return "VFF";
    if (containsAny(releaseHaystack, VFI_KEYWORDS)) return "VFI";
  }
  return "FR";
}

function classifyTrack(
  track: LibraryAudioTrack,
  releaseName: string | null,
): LanguageTag {
  const rawCode = normalize(track.language);
  const code = normalizeLanguageCode(track.language);
  if (EN_CODES.has(code)) return "EN";
  if (FR_CODES.has(code)) {
    if (
      rawCode.includes("fr-ca") ||
      rawCode.includes("fr_ca") ||
      rawCode.includes("frca")
    ) {
      return "VFQ";
    }
    if (
      rawCode.includes("fr-fr") ||
      rawCode.includes("fr_fr") ||
      rawCode.includes("frfr")
    ) {
      return "VFF";
    }
    return classifyFrenchTrack(track.title, releaseName);
  }
  if (!code || code === "und" || code === "zxx") {
    // Language code is unknown — try to recover from the track title.
    const titleHaystack = normalize(track.title);
    if (titleHaystack) {
      if (
        containsAny(titleHaystack, VFQ_KEYWORDS) ||
        containsAny(titleHaystack, VFF_KEYWORDS) ||
        containsAny(titleHaystack, VFI_KEYWORDS) ||
        titleHaystack.includes("french") ||
        titleHaystack.includes("francais")
      ) {
        return classifyFrenchTrack(track.title, releaseName);
      }
      if (
        titleHaystack.includes("english") ||
        titleHaystack.includes("anglais")
      ) {
        return "EN";
      }
    }
    return "UND";
  }
  return code.slice(0, 3).toUpperCase();
}

/**
 * Returns a sorted, de-duplicated list of language tags derived from the
 * file's audio tracks. Uses the release name as a fallback to distinguish
 * VFQ/VFF when the track title is silent.
 */
export function classifyLanguageTags(
  audioTracks: LibraryAudioTrack[] | null | undefined,
  releaseName: string | null = null,
): LanguageTag[] {
  if (!audioTracks || audioTracks.length === 0) return [];
  const tags = new Set<LanguageTag>();
  for (const track of audioTracks) {
    tags.add(classifyTrack(track, releaseName));
  }
  return [...tags].sort(compareTags);
}

const TAG_ORDER: Record<string, number> = {
  EN: 0,
  VFQ: 1,
  VFF: 2,
  VFI: 3,
  FR: 4,
};

function compareTags(a: LanguageTag, b: LanguageTag): number {
  const ai = TAG_ORDER[a] ?? 100;
  const bi = TAG_ORDER[b] ?? 100;
  if (ai !== bi) return ai - bi;
  return a.localeCompare(b);
}
