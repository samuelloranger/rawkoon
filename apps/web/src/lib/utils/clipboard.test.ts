import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyToClipboard", () => {
  it("reports success", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    expect(await copyToClipboard("x")).toBe(true);
  });

  it("reports failure when the browser refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    expect(await copyToClipboard("x")).toBe(false);
  });

  it("reports failure when the clipboard API is missing (plain-http origin)", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyToClipboard("x")).toBe(false);
  });
});
