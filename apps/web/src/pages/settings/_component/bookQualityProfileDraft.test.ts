import { describe, expect, it } from "vitest";
import type { BookProfileDraftState } from "./bookQualityProfileDraft";
import {
  bookProfileDraftToBody,
  emptyBookProfileDraft,
  moveFormat,
  pruneDraftForKind,
  toggleFormat,
  validateBookProfileDraft,
} from "./bookQualityProfileDraft";

/** A draft with the fields a case cares about, correctly typed. */
const draftWith = (
  over: Partial<BookProfileDraftState>,
): BookProfileDraftState => ({ ...emptyBookProfileDraft(), ...over });

describe("pruneDraftForKind", () => {
  it("drops formats belonging to the other kind, and the cutoff with them", () => {
    const draft = draftWith({
      allowedFormats: ["epub", "pdf"],
      cutoffFormat: "pdf",
    });

    const next = pruneDraftForKind(draft, "audiobook");

    expect(next.allowedFormats).toEqual([]);
    expect(next.cutoffFormat).toBe(null);
  });

  it("keeps a cutoff that survives the switch", () => {
    const draft = draftWith({
      kind: "both",
      allowedFormats: ["epub", "m4b"],
      cutoffFormat: "epub",
    });

    const next = pruneDraftForKind(draft, "ebook");

    expect(next.allowedFormats).toEqual(["epub"]);
    expect(next.cutoffFormat).toBe("epub");
  });

  it("clears the bitrate floor for an ebook profile", () => {
    const draft = draftWith({
      kind: "audiobook",
      allowedFormats: ["m4b"],
      minAudioBitrate: "128",
    });

    expect(pruneDraftForKind(draft, "ebook").minAudioBitrate).toBe("");
  });
});

describe("toggleFormat", () => {
  it("appends in click order, so selection order is preference order", () => {
    let draft = draftWith({ allowedFormats: [] });
    draft = toggleFormat(draft, "pdf");
    draft = toggleFormat(draft, "epub");

    expect(draft.allowedFormats).toEqual(["pdf", "epub"]);
  });

  it("clears the cutoff when the cutoff format is removed", () => {
    const draft = toggleFormat(
      draftWith({ allowedFormats: ["epub", "pdf"], cutoffFormat: "pdf" }),
      "pdf",
    );

    expect(draft.allowedFormats).toEqual(["epub"]);
    expect(draft.cutoffFormat).toBe(null);
  });
});

describe("moveFormat", () => {
  it("moves a format one place and leaves the rest in order", () => {
    const draft = draftWith({ allowedFormats: ["epub", "azw3", "pdf"] });

    expect(moveFormat(draft, 2, 1).allowedFormats).toEqual([
      "epub",
      "pdf",
      "azw3",
    ]);
  });

  it("refuses to move past either end", () => {
    const draft = draftWith({ allowedFormats: ["epub", "azw3"] });

    expect(moveFormat(draft, 0, -1).allowedFormats).toEqual(["epub", "azw3"]);
    expect(moveFormat(draft, 1, 2).allowedFormats).toEqual(["epub", "azw3"]);
  });
});

describe("validateBookProfileDraft", () => {
  it("requires a name and at least one format", () => {
    expect(validateBookProfileDraft(emptyBookProfileDraft())).toEqual({
      code: "name_required",
    });
    expect(
      validateBookProfileDraft(
        draftWith({ name: "Standard", allowedFormats: [] }),
      ),
    ).toEqual({ code: "formats_required" });
  });

  it("accepts a coherent draft", () => {
    expect(
      validateBookProfileDraft(
        draftWith({ name: "Standard", cutoffFormat: "epub" }),
      ),
    ).toBe(null);
  });

  it("reports a format that does not belong to the kind", () => {
    const error = validateBookProfileDraft(
      draftWith({ name: "Mixed", kind: "audiobook", allowedFormats: ["epub"] }),
    );

    expect(error).toEqual({
      code: "invalid",
      message: "Formats not valid for a audiobook profile: epub",
    });
  });
});

describe("bookProfileDraftToBody", () => {
  it("treats empty numbers as no limit and a blank seeder floor as zero", () => {
    const body = bookProfileDraftToBody(
      draftWith({ name: "  Standard  ", minSeeders: "" }),
    );

    expect(body.name).toBe("Standard");
    expect(body.max_size_mb).toBe(null);
    expect(body.min_seeders).toBe(0);
  });

  it("never sends a bitrate floor on an ebook profile", () => {
    const body = bookProfileDraftToBody(
      draftWith({ name: "Standard", minAudioBitrate: "128" }),
    );

    expect(body.min_audio_bitrate).toBe(null);
  });

  it("keeps the bitrate floor on an audiobook profile", () => {
    const body = bookProfileDraftToBody(
      draftWith({
        name: "Audio",
        kind: "audiobook",
        allowedFormats: ["m4b"],
        minAudioBitrate: "128",
      }),
    );

    expect(body.min_audio_bitrate).toBe(128);
  });
});
