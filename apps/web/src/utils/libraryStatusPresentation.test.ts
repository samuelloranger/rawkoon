import { describe, it, expect } from "vitest";
import {
  displayLibraryStatus,
  libraryStatusPresentation,
} from "./libraryStatusPresentation";
import type { LibraryMediaStatus } from "@rawkoon/shared/types";

const ALL: LibraryMediaStatus[] = [
  "wanted",
  "downloading",
  "downloaded",
  "skipped",
  "upgrading",
];

describe("libraryStatusPresentation", () => {
  it("maps every status to a presentation", () => {
    for (const s of ALL) {
      const p = libraryStatusPresentation(s);
      expect(p.cardStatus).toBeTruthy();
      expect(p.liseretClass).toMatch(/^bg-/);
      expect(p.badgeClass).toContain("text-");
      expect(typeof p.showBadge).toBe("boolean");
      expect(p.labelKey).toContain("medias.library.itemStatus.");
    }
  });
  it("downloaded is the calm healthy state (no badge)", () => {
    const p = libraryStatusPresentation("downloaded");
    expect(p.cardStatus).toBe("downloaded");
    expect(p.showBadge).toBe(false);
    expect(p.liseretClass).toBe("bg-emerald-400");
  });
  it("wanted is attention (rose) and shows a badge", () => {
    const p = libraryStatusPresentation("wanted");
    expect(p.cardStatus).toBe("missing");
    expect(p.showBadge).toBe(true);
    expect(p.liseretClass).toBe("bg-rose-400");
  });
  it("upgrading maps to in-progress (sky)", () => {
    const p = libraryStatusPresentation("upgrading");
    expect(p.cardStatus).toBe("downloading");
    expect(p.liseretClass).toBe("bg-sky-400");
  });
  it("offers a search quick-action only for missing/wanted", () => {
    expect(libraryStatusPresentation("wanted").quickAction).toBe("search");
    expect(libraryStatusPresentation("downloaded").quickAction).toBe(null);
  });
  it("labels a downloaded airing show by its airing state, as clients always did", () => {
    const returning = libraryStatusPresentation("downloaded", "returning");
    expect(returning.cardStatus).toBe("returning");
    expect(returning.liseretClass).toBe("bg-primary-400");
    expect(returning.labelKey).toBe("medias.library.itemStatus.returning");
    const inProduction = libraryStatusPresentation(
      "downloaded",
      "in_production",
    );
    expect(inProduction.cardStatus).toBe("in_production");
    expect(inProduction.liseretClass).toBe("bg-amber-400");
    const planned = libraryStatusPresentation("downloaded", "planned");
    expect(planned.cardStatus).toBe("planned");
    expect(planned.labelKey).toBe("medias.library.itemStatus.planned");
  });
  it("keeps a finished or unknown show plainly downloaded", () => {
    for (const airing of ["ended", null, undefined] as const) {
      const p = libraryStatusPresentation("downloaded", airing);
      expect(p.cardStatus).toBe("downloaded");
      expect(p.labelKey).toBe("medias.library.itemStatus.downloaded");
    }
  });
  it("lets an acquisition status win over the airing state", () => {
    expect(libraryStatusPresentation("wanted", "returning").cardStatus).toBe(
      "missing",
    );
    expect(displayLibraryStatus("downloading", "returning")).toBe(
      "downloading",
    );
  });
});
