import { describe, expect, it } from "vitest";
import { isDeckShortcut } from "./deckShortcut";

function press(key: string, target: Element, init: KeyboardEventInit = {}) {
  let result = false;
  target.addEventListener("keydown", (e) => {
    result = isDeckShortcut(e);
  });
  target.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
  return result;
}

describe("isDeckShortcut", () => {
  it("accepts arrows on the page body", () => {
    expect(press("ArrowLeft", document.createElement("div"))).toBe(true);
  });
  it("ignores arrows typed into a text field", () => {
    expect(press("ArrowLeft", document.createElement("input"))).toBe(false);
  });
  it("lets Enter activate a focused button instead of adding the title", () => {
    expect(press("Enter", document.createElement("button"))).toBe(false);
    expect(press("ArrowLeft", document.createElement("button"))).toBe(true);
  });
  it("ignores keys with a modifier", () => {
    expect(
      press("ArrowLeft", document.createElement("div"), { ctrlKey: true }),
    ).toBe(false);
  });
});
