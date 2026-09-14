import { describe, expect, it, mock } from "bun:test";

mock.module("@rawkoon/api/services/crypto", () => ({
  decrypt: (v: string) => {
    if (v === "bad") throw new Error("cannot decrypt");
    return v.replace(/^enc:/, "");
  },
  encrypt: (v: string) => `enc:${v}`,
}));

const { normalizeFanartConfig } = await import(
  "@rawkoon/api/utils/integrations/normalizers"
);

describe("normalizeFanartConfig", () => {
  it("decrypts the stored key", () => {
    expect(normalizeFanartConfig({ api_key: "enc:abc" })).toEqual({
      api_key: "abc",
    });
  });

  it("returns null when there is no key", () => {
    expect(normalizeFanartConfig({ api_key: "" })).toBeNull();
    expect(normalizeFanartConfig({})).toBeNull();
  });

  it("returns null for a non-object config", () => {
    expect(normalizeFanartConfig(null)).toBeNull();
    expect(normalizeFanartConfig("nope")).toBeNull();
    expect(normalizeFanartConfig([])).toBeNull();
  });

  it("fails closed when the key cannot be decrypted", () => {
    expect(normalizeFanartConfig({ api_key: "bad" })).toBeNull();
  });
});
