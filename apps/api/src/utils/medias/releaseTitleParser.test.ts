import { describe, expect, test } from "bun:test";
import { parseReleaseTitle } from "@rawkoon/api/utils/medias/filenameParser";
import { releaseTitleCasesA } from "./releaseTitleParser.cases";
import { releaseTitleCasesB } from "./releaseTitleParser.cases2";

describe("parseReleaseTitle", () => {
  for (const { title, exp } of [...releaseTitleCasesA, ...releaseTitleCasesB]) {
    test(title.slice(0, 60), () => {
      expect(parseReleaseTitle(title)).toEqual(exp);
    });
  }
});
