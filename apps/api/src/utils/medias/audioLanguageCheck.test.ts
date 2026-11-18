import { describe, expect, it } from "bun:test";
import { checkAudioLanguages } from "@rawkoon/api/utils/medias/audioLanguageCheck";

const t = (language: string, title: string | null = null) => ({
  language,
  title,
});

describe("checkAudioLanguages", () => {
  it("skips a profile with no preferred languages", () => {
    expect(checkAudioLanguages([t("eng")], []).status).toBe("skip");
    expect(checkAudioLanguages([t("eng")], ["MULTI"]).status).toBe("skip");
  });

  it("skips when every track language is undetermined", () => {
    expect(checkAudioLanguages([t("und"), t("")], ["VFF"]).status).toBe("skip");
    expect(checkAudioLanguages([], ["VFF"]).status).toBe("skip");
  });

  it("matches by family across ISO codes and regions", () => {
    for (const lang of ["fre", "fra", "fr", "fr-CA", "VFF"])
      expect(checkAudioLanguages([t("eng"), t(lang)], ["VFF"]).status).toBe(
        "ok",
      );
  });

  it("flags a file with no preferred-family audio", () => {
    expect(checkAudioLanguages([t("eng"), t("und")], ["VFF"])).toEqual({
      status: "mismatch",
      fileLanguages: ["eng"],
    });
  });

  it("treats an English preference like any other family", () => {
    expect(checkAudioLanguages([t("fre")], ["en"]).status).toBe("mismatch");
    expect(checkAudioLanguages([t("eng")], ["en"]).status).toBe("ok");
  });

  it("warns when VFQ is preferred and only France-French evidence exists", () => {
    expect(checkAudioLanguages([t("fre", "VFF")], ["VFQ"]).status).toBe("warn");
    expect(checkAudioLanguages([t("fr-FR")], ["VFQ"]).status).toBe("warn");
  });

  it("accepts VFQ evidence from the tag or the track title", () => {
    expect(checkAudioLanguages([t("fr-CA")], ["VFQ"]).status).toBe("ok");
    expect(
      checkAudioLanguages([t("fre", "Français (Québec)")], ["VFQ"]).status,
    ).toBe("ok");
    expect(
      checkAudioLanguages([t("fre", "VFF"), t("fre", "VFQ")], ["VFQ"]).status,
    ).toBe("ok");
  });

  it("does not warn on untagged French or when another French flag is preferred", () => {
    expect(checkAudioLanguages([t("fre")], ["VFQ"]).status).toBe("ok");
    expect(checkAudioLanguages([t("fre", "VFF")], ["VFQ", "VFF"]).status).toBe(
      "ok",
    );
  });
});
