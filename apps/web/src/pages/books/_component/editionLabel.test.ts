import { describe, expect, it } from "vitest";
import { editionChipLabel } from "@/pages/books/_component/editionLabel";

describe("editionChipLabel", () => {
  it("never hides the status behind the format", () => {
    // Regression: the chip used to render `format ?? status`, so a fully
    // imported book showed "epub" and the word "downloaded" appeared nowhere.
    expect(editionChipLabel("Downloaded", "epub")).toContain("Downloaded");
  });

  it("still surfaces the format when there is one", () => {
    expect(editionChipLabel("Downloaded", "epub")).toBe("Downloaded · epub");
  });

  it("shows the bare status before any file exists", () => {
    expect(editionChipLabel("Wanted", null)).toBe("Wanted");
    expect(editionChipLabel("Downloading", null)).toBe("Downloading");
  });

  // The status arrives already translated, so a French label passes through
  // unchanged rather than being re-derived from the server's English value.
  it("passes a translated status through untouched", () => {
    expect(editionChipLabel("Téléchargé", "epub")).toBe("Téléchargé · epub");
  });
});
