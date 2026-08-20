/**
 * Infer a language from an ISBN's registration group.
 *
 * Google Books' `language` field is not trustworthy. A French volume — French
 * title, French publisher, French description, French ISBN — was observed
 * reported as Arabic. The field is wrong often enough that it needs a
 * cross-check, and the ISBN carries one: the registration group after the
 * 978/979 prefix identifies the language area a publisher registered in.
 *
 * This is a hint, not a fact. A French publisher can and does issue English
 * editions, so the group tells you the registration area rather than the words
 * on the page. Use it to correct an obviously wrong provider value, never as
 * the sole source of truth.
 *
 * Groups are matched longest-first, since they are variable length ("2" is
 * French, but "84" is Spanish and "972" is Portuguese).
 */

/** Registration group → ISO 639-1, longest prefix wins. */
const GROUP_TO_LANGUAGE: [string, string][] = [
  // 979 prefixes are allocated separately from 978 and must be matched first.
  ["97910", "fr"], // France
  ["97911", "ko"],
  ["97912", "it"],
  ["9798", "en"], // United States
  // 978 groups.
  ["978600", "fa"], // Iran
  ["978602", "id"],
  ["978604", "vi"],
  ["978611", "kk"],
  ["978613", "en"],
  ["978614", "ar"], // Lebanon
  ["978950", "es"], // Argentina
  ["978951", "fi"],
  ["978952", "fi"],
  ["978953", "hr"],
  ["978954", "bg"],
  ["978955", "si"],
  ["978957", "zh"],
  ["978958", "es"],
  ["978959", "es"],
  ["978960", "el"],
  ["978961", "sl"],
  ["978962", "zh"],
  ["978963", "hu"],
  ["978964", "fa"],
  ["978965", "he"],
  ["978966", "uk"],
  ["978967", "ms"],
  ["978968", "es"],
  ["978970", "es"],
  ["978971", "tl"],
  ["978972", "pt"],
  ["978973", "ro"],
  ["978974", "th"],
  ["978975", "tr"],
  ["978976", "en"],
  ["978977", "ar"], // Egypt
  ["978978", "en"], // Nigeria
  ["978979", "id"],
  ["978980", "es"],
  ["978981", "en"],
  ["978982", "en"],
  ["978983", "ms"],
  ["978984", "bn"],
  ["978985", "be"],
  ["978986", "zh"],
  ["978987", "es"],
  ["97880", "cs"],
  ["97881", "en"], // India
  ["97882", "no"],
  ["97883", "pl"],
  ["97884", "es"],
  ["97885", "pt"], // Brazil
  ["97886", "sr"],
  ["97887", "da"],
  ["97888", "it"],
  ["97889", "ko"],
  ["97890", "nl"],
  ["97891", "sv"],
  ["97892", "en"], // international organisations
  ["97893", "de"], // India, but German-group allocation
  ["9780", "en"],
  ["9781", "en"],
  ["9782", "fr"],
  ["9783", "de"],
  ["9784", "ja"],
  ["9785", "ru"],
  ["9787", "zh"],
];

/** Digits only; drops hyphens and spaces. */
const digitsOf = (isbn: string): string => isbn.replace(/[^0-9Xx]/g, "");

/**
 * ISO 639-1 language implied by an ISBN-13's registration group, or null when
 * the group is unknown or the input is not an ISBN-13.
 */
export function languageFromIsbn13(
  isbn: string | null | undefined,
): string | null {
  if (!isbn) return null;
  const digits = digitsOf(isbn);
  if (!/^97[89]\d{10}$/.test(digits)) return null;

  for (const [group, language] of GROUP_TO_LANGUAGE) {
    if (digits.startsWith(group)) return language;
  }
  return null;
}

/**
 * Reconcile a provider-reported language against the ISBN.
 *
 * Prefers the ISBN's group when the two disagree, because the provider field is
 * the one observed to be wrong. Returns the provider value unchanged when there
 * is no ISBN, no known group, or the two already agree.
 */
export function reconcileBookLanguage(
  providerLanguage: string | null | undefined,
  isbn13: string | null | undefined,
): { language: string; correctedFrom: string | null } {
  const provider = (providerLanguage ?? "").trim().toLowerCase().slice(0, 2);
  const fromIsbn = languageFromIsbn13(isbn13);

  if (!fromIsbn) return { language: provider || "en", correctedFrom: null };
  if (!provider) return { language: fromIsbn, correctedFrom: null };
  if (provider === fromIsbn) return { language: provider, correctedFrom: null };

  return { language: fromIsbn, correctedFrom: provider };
}
