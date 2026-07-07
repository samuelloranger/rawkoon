// Localized human-readable language names from ISO 639-1 codes, via the
// platform's Intl.DisplayNames. Used by the interactive-search title picker so
// "de" renders as "German" (EN UI) or "allemand" (FR UI).

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function getDisplayNames(locale: string): Intl.DisplayNames | null {
  const cached = displayNamesCache.get(locale);
  if (cached !== undefined) return cached;
  let instance: Intl.DisplayNames | null;
  try {
    instance = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    instance = null;
  }
  displayNamesCache.set(locale, instance);
  return instance;
}

/**
 * Returns the localized display name for an ISO 639-1 language `code`, rendered
 * in `locale`. Falls back to the uppercased code when the platform can't
 * resolve a name.
 */
export function languageDisplayName(code: string, locale: string): string {
  const displayNames = getDisplayNames(locale);
  if (displayNames) {
    try {
      const name = displayNames.of(code);
      if (name && name.toLowerCase() !== code.toLowerCase()) {
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    } catch {
      // fall through to the code-based fallback
    }
  }
  return code.toUpperCase();
}
