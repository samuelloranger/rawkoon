import { describe, it, expect } from "vitest";
import {
  REJECTION_CODE_KEYS,
  COMPONENT_CODE_KEYS,
  CONDITION_TYPE_KEYS,
  OPERATOR_KEYS,
  VALIDATION_CODE_KEYS,
} from "@/lib/i18n/scoringCodes";
import en from "@/locales/en/common.json";
import fr from "@/locales/fr/common.json";

type JsonObj = Record<string, unknown>;

/**
 * Walk a dotted key path (e.g. "scoring.reject.isSample") through a nested
 * JSON object. Returns the leaf value, or undefined if any segment is missing.
 */
function resolve(obj: JsonObj, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((cur, seg) => {
    if (cur == null || typeof cur !== "object") return undefined;
    return (cur as JsonObj)[seg];
  }, obj);
}

const ALL_MAPS: [string, Record<string, string>][] = [
  ["REJECTION_CODE_KEYS", REJECTION_CODE_KEYS],
  ["COMPONENT_CODE_KEYS", COMPONENT_CODE_KEYS],
  ["CONDITION_TYPE_KEYS", CONDITION_TYPE_KEYS],
  ["OPERATOR_KEYS", OPERATOR_KEYS],
  ["VALIDATION_CODE_KEYS", VALIDATION_CODE_KEYS],
];

describe("scoringCodes i18n parity", () => {
  for (const [mapName, map] of ALL_MAPS) {
    describe(mapName, () => {
      for (const [code, dotKey] of Object.entries(map)) {
        it(`${code} → "${dotKey}" resolves in en`, () => {
          const val = resolve(en as unknown as JsonObj, dotKey);
          expect(
            val,
            `en: key "${dotKey}" (from code "${code}") is missing or empty`,
          ).toBeTruthy();
          expect(typeof val).toBe("string");
        });

        it(`${code} → "${dotKey}" resolves in fr`, () => {
          const val = resolve(fr as unknown as JsonObj, dotKey);
          expect(
            val,
            `fr: key "${dotKey}" (from code "${code}") is missing or empty`,
          ).toBeTruthy();
          expect(typeof val).toBe("string");
        });
      }
    });
  }
});
