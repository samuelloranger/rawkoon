import { describe, it, expect, beforeEach, vi } from "vitest";
import { webDeviceId } from "./deviceId";

describe("webDeviceId", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.mocked(localStorage.getItem).mockImplementation(
      (key) => store.get(key) ?? null,
    );
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      store.set(key, String(value));
    });
  });

  it("creates and reuses a UUID", () => {
    const a = webDeviceId();
    const b = webDeviceId();
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
