import { describe, expect, it } from "vitest";
import {
  aggregateState,
  byKindOrder,
  stateTokens,
} from "@/pages/books/_component/bookState";

describe("aggregateState", () => {
  // The row rail is the only state signal on a collapsed row, so it must never
  // claim a book is complete while one of its editions is still missing. This
  // replaces the old editionChipLabel test, which guarded the same honesty rule
  // on the chip that no longer exists.
  it("reports the least-finished edition, not the best one", () => {
    expect(
      aggregateState([{ status: "downloaded" }, { status: "wanted" }]),
    ).toBe("wanted");
    expect(
      aggregateState([{ status: "downloaded" }, { status: "downloading" }]),
    ).toBe("downloading");
    expect(
      aggregateState([{ status: "downloaded" }, { status: "skipped" }]),
    ).toBe("skipped");
  });

  it("reports downloaded only when every edition is", () => {
    expect(
      aggregateState([{ status: "downloaded" }, { status: "downloaded" }]),
    ).toBe("downloaded");
  });

  // A book always has at least one edition by construction, but a rail that
  // silently picked a colour from an empty list would be a lie either way.
  it("has no state for a book with no editions", () => {
    expect(aggregateState([])).toBeNull();
  });
});

describe("stateTokens", () => {
  it("gives every known state its own colour", () => {
    const rails = (
      ["wanted", "downloading", "upgrading", "downloaded", "skipped"] as const
    ).map((s) => stateTokens(s).rail);
    expect(new Set(rails).size).toBe(rails.length);
  });

  // A status the client does not know about must still render as something.
  it("falls back rather than returning undefined tokens", () => {
    const tokens = stateTokens("some-future-status");
    expect(tokens.rail).toBeTruthy();
    expect(tokens.dot).toBeTruthy();
    expect(tokens.text).toBeTruthy();
  });
});

describe("byKindOrder", () => {
  it("puts the ebook first, since that is the default kind on add", () => {
    expect(
      byKindOrder([{ kind: "audiobook" }, { kind: "ebook" }]).map(
        (e) => e.kind,
      ),
    ).toEqual(["ebook", "audiobook"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [{ kind: "audiobook" }, { kind: "ebook" }];
    byKindOrder(input);
    expect(input.map((e) => e.kind)).toEqual(["audiobook", "ebook"]);
  });
});
