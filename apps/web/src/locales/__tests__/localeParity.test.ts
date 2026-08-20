import { describe, expect, it } from "vitest";
import en from "@/locales/en/common.json";
import fr from "@/locales/fr/common.json";

/**
 * The two locale files must carry the same keys.
 *
 * Nothing enforced this before, and the books feature shipped with its whole UI
 * hardcoded in English — no keys at all, so no drift to notice. A missing key
 * falls back to English silently, which is exactly why it goes unseen: the app
 * looks fine to an English reader and is half-translated for everyone else.
 *
 * i18next plural suffixes are kept as-is. English has _one/_other and French
 * uses the same two categories, so a key present in one locale with a suffix
 * must be present in the other with that suffix too.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${prefix}${key}`]
      : flatten(value, `${prefix}${key}.`),
  );
}

const enKeys = flatten(en as Tree);
const frKeys = flatten(fr as Tree);

describe("locale parity", () => {
  it("has no English key missing from French", () => {
    const missing = enKeys.filter((k) => !frKeys.includes(k));
    expect(missing).toEqual([]);
  });

  it("has no French key missing from English", () => {
    const extra = frKeys.filter((k) => !enKeys.includes(k));
    expect(extra).toEqual([]);
  });

  // A key whose French value is byte-identical to the English one is usually an
  // untranslated placeholder. Proper nouns, format names and symbols legitimately
  // match, so this only reports the count for visibility rather than failing.
  it("reports how many values are identical in both locales", () => {
    const flatValues = (tree: Tree, prefix = ""): Record<string, string> =>
      Object.entries(tree).reduce<Record<string, string>>(
        (acc, [key, value]) =>
          typeof value === "string"
            ? { ...acc, [`${prefix}${key}`]: value }
            : { ...acc, ...flatValues(value, `${prefix}${key}.`) },
        {},
      );
    const enValues = flatValues(en as Tree);
    const frValues = flatValues(fr as Tree);
    const identical = Object.keys(enValues).filter(
      (k) => enValues[k] === frValues[k] && enValues[k].trim().length > 1,
    );
    // Not an assertion about quality — just proof the comparison runs and that
    // the set has not exploded.
    expect(identical.length).toBeLessThan(enKeys.length / 2);
  });
});
