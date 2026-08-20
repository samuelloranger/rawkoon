import { describe, expect, it } from "vitest";
import {
  editionChipLabel,
  isTransientEditionStatus,
} from "@/pages/books/_component/editionLabel";

describe("editionChipLabel", () => {
  it("never hides the status behind the format", () => {
    // Regression: the chip used to render `format ?? status`, so a fully
    // imported book showed "epub" and the word "downloaded" appeared nowhere.
    expect(editionChipLabel("downloaded", "epub")).toContain("downloaded");
  });

  it("still surfaces the format when there is one", () => {
    expect(editionChipLabel("downloaded", "epub")).toBe("downloaded · epub");
  });

  it("shows the bare status before any file exists", () => {
    expect(editionChipLabel("wanted", null)).toBe("wanted");
    expect(editionChipLabel("downloading", null)).toBe("downloading");
  });
});

describe("isTransientEditionStatus", () => {
  it("treats in-flight states as transient so the UI keeps polling", () => {
    expect(isTransientEditionStatus("downloading")).toBe(true);
    expect(isTransientEditionStatus("upgrading")).toBe(true);
  });

  it("treats settled states as final", () => {
    expect(isTransientEditionStatus("downloaded")).toBe(false);
    expect(isTransientEditionStatus("wanted")).toBe(false);
    expect(isTransientEditionStatus("skipped")).toBe(false);
  });
});
