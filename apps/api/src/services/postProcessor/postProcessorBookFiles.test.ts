import { describe, expect, it } from "bun:test";

import { candidateFormat } from "./postProcessorBookFiles";

describe("candidateFormat", () => {
  it("accepts a real ebook", () => {
    expect(candidateFormat("/dl/Book/Book.epub", "ebook")).toBe("epub");
  });

  it("rejects macOS AppleDouble sidecars that carry a book extension", () => {
    expect(candidateFormat("/dl/Book/._Book.epub", "ebook")).toBeNull();
    expect(
      candidateFormat("/dl/__MACOSX/Book/._01.mp3", "audiobook"),
    ).toBeNull();
  });
});
