import { describe, it, expect } from "bun:test";
import { appendJellyfinImageSizing } from "@rawkoon/api/utils/dashboard/jellyfin";

describe("appendJellyfinImageSizing", () => {
  it("caps Primary posters at fillWidth=320 quality=90", () => {
    const u = new URL("http://jelly.local/Items/abc/Images/Primary");
    appendJellyfinImageSizing(u, "Primary");
    expect(u.searchParams.get("fillWidth")).toBe("320");
    expect(u.searchParams.get("quality")).toBe("90");
  });

  it("caps Backdrop images at fillWidth=640 quality=80", () => {
    const u = new URL("http://jelly.local/Items/abc/Images/Backdrop");
    appendJellyfinImageSizing(u, "Backdrop");
    expect(u.searchParams.get("fillWidth")).toBe("640");
    expect(u.searchParams.get("quality")).toBe("80");
  });

  it("preserves an existing tag param", () => {
    const u = new URL("http://jelly.local/Items/abc/Images/Primary?tag=t1");
    appendJellyfinImageSizing(u, "Primary");
    expect(u.searchParams.get("tag")).toBe("t1");
    expect(u.searchParams.get("fillWidth")).toBe("320");
  });
});
