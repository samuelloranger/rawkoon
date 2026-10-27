import { normalizeLanguageCode } from "@rawkoon/shared";

/**
 * Refine a French audio track's language label using its MediaInfo Title field
 * and filename flags (VFF, VFQ, TRUEFRENCH, etc.).
 */
export function refineFrenchAudioLabel(
  language: string,
  title: string | null,
  audioFlags: string[],
  trackIndex: number,
): { language: string; language_name: string } {
  const normalizedLanguage = normalizeLanguageCode(language);
  const rawLanguage = language.toLowerCase();
  const isFrench =
    normalizedLanguage === "fr" ||
    normalizedLanguage === "fre" ||
    normalizedLanguage === "fra" ||
    normalizedLanguage === "french";
  if (!isFrench)
    return {
      language: normalizedLanguage || "und",
      language_name: expandLanguageCode(normalizedLanguage || "und"),
    };

  if (
    rawLanguage.includes("fr-ca") ||
    rawLanguage.includes("fr_ca") ||
    rawLanguage.includes("frca")
  ) {
    return { language: "VFQ", language_name: "French (Québec)" };
  }
  if (
    rawLanguage.includes("fr-fr") ||
    rawLanguage.includes("fr_fr") ||
    rawLanguage.includes("frfr")
  ) {
    return { language: "VFF", language_name: "French (France)" };
  }

  const t = (title ?? "").toLowerCase();

  // Track title is the most reliable source
  if (/vfq|vqc|qu[eé]bec|qu[eé]b|canadien|canadian/i.test(t))
    return { language: "VFQ", language_name: "French (Québec)" };
  if (/vff|france|truefrench|europ/i.test(t))
    return { language: "VFF", language_name: "French (France)" };
  if (/vfi|international/i.test(t))
    return { language: "VFI", language_name: "French (International)" };

  // Fall back to filename flags
  if (audioFlags.includes("VF2")) {
    // VF2 = VFF + VFQ; first French track = VFF, second = VFQ
    return trackIndex === 0
      ? { language: "VFF", language_name: "French (France)" }
      : { language: "VFQ", language_name: "French (Québec)" };
  }
  if (audioFlags.includes("TRUEFRENCH"))
    return { language: "VFF", language_name: "French (TRUEFRENCH)" };
  if (audioFlags.includes("VFF"))
    return { language: "VFF", language_name: "French (France)" };
  if (audioFlags.includes("VFQ"))
    return { language: "VFQ", language_name: "French (Québec)" };
  if (audioFlags.includes("VFI"))
    return { language: "VFI", language_name: "French (International)" };

  return { language: "fra", language_name: "French" };
}

const ISO_639_2_NAMES: Record<string, string> = {
  en: "English",
  eng: "English",
  fr: "French",
  fra: "French",
  fre: "French",
  es: "Spanish",
  spa: "Spanish",
  de: "German",
  deu: "German",
  ger: "German",
  it: "Italian",
  ita: "Italian",
  pt: "Portuguese",
  por: "Portuguese",
  ja: "Japanese",
  jpn: "Japanese",
  zh: "Chinese",
  chi: "Chinese",
  zho: "Chinese",
  ko: "Korean",
  kor: "Korean",
  ru: "Russian",
  rus: "Russian",
  ar: "Arabic",
  ara: "Arabic",
  hi: "Hindi",
  hin: "Hindi",
  nl: "Dutch",
  nld: "Dutch",
  sv: "Swedish",
  swe: "Swedish",
  no: "Norwegian",
  nor: "Norwegian",
  da: "Danish",
  dan: "Danish",
  fi: "Finnish",
  fin: "Finnish",
  pl: "Polish",
  pol: "Polish",
  tr: "Turkish",
  tur: "Turkish",
  he: "Hebrew",
  heb: "Hebrew",
  th: "Thai",
  tha: "Thai",
  vi: "Vietnamese",
  vie: "Vietnamese",
  id: "Indonesian",
  ind: "Indonesian",
  ms: "Malay",
  msa: "Malay",
  cs: "Czech",
  ces: "Czech",
  cze: "Czech",
  sk: "Slovak",
  slk: "Slovak",
  hu: "Hungarian",
  hun: "Hungarian",
  ro: "Romanian",
  ron: "Romanian",
  rum: "Romanian",
  bg: "Bulgarian",
  bul: "Bulgarian",
  hr: "Croatian",
  hrv: "Croatian",
  sr: "Serbian",
  srp: "Serbian",
  uk: "Ukrainian",
  ukr: "Ukrainian",
  el: "Greek",
  ell: "Greek",
  ca: "Catalan",
  cat: "Catalan",
  und: "Unknown",
};

export function expandLanguageCode(code: string): string {
  const normalized = normalizeLanguageCode(code) || "und";
  return ISO_639_2_NAMES[normalized] ?? normalized;
}
