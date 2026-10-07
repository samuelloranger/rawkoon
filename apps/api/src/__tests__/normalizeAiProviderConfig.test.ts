import { describe, it, expect } from "bun:test";
import { normalizeAiProviderConfig } from "@rawkoon/api/utils/integrations/normalizers";

describe("normalizeAiProviderConfig", () => {
  it("returns null for null input", () => {
    expect(normalizeAiProviderConfig(null)).toBeNull();
  });

  it("returns null when base_url is missing", () => {
    expect(normalizeAiProviderConfig({ model: "llama3.2" })).toBeNull();
  });

  it("returns null when model is missing", () => {
    expect(
      normalizeAiProviderConfig({ base_url: "http://localhost:11434" }),
    ).toBeNull();
  });

  it("returns config with trimmed trailing slash on base_url", () => {
    const result = normalizeAiProviderConfig({
      base_url: "http://homelab:11434/",
      model: "llama3.2",
    });
    expect(result).toEqual({
      base_url: "http://homelab:11434",
      model: "llama3.2",
    });
  });

  it("returns config as-is when valid", () => {
    const result = normalizeAiProviderConfig({
      base_url: "http://homelab:11434",
      model: "mistral",
    });
    expect(result).toEqual({
      base_url: "http://homelab:11434",
      model: "mistral",
    });
  });
});

describe("normalizeAiProviderConfig prices", () => {
  it("keeps non-negative numeric prices and drops anything else", () => {
    const base = { base_url: "http://x", model: "m" };
    expect(
      normalizeAiProviderConfig({
        ...base,
        input_price_per_million: 0.59,
        output_price_per_million: 0,
      }),
    ).toMatchObject({
      input_price_per_million: 0.59,
      output_price_per_million: 0,
    });
    const bad = normalizeAiProviderConfig({
      ...base,
      input_price_per_million: -1,
      output_price_per_million: "2",
    });
    expect(bad).not.toHaveProperty("input_price_per_million");
    expect(bad).not.toHaveProperty("output_price_per_million");
  });

  it("keeps a budget and known feature toggles, dropping junk", () => {
    const result = normalizeAiProviderConfig({
      base_url: "http://h",
      model: "m",
      daily_budget_usd: 2.5,
      features: {
        release_pick_rss: false,
        nonsense: false,
        book_release_pick: "no",
      },
    });
    expect(result).toEqual({
      base_url: "http://h",
      model: "m",
      daily_budget_usd: 2.5,
      features: { release_pick_rss: false },
    });
  });

  it("omits an invalid budget and empty features", () => {
    const result = normalizeAiProviderConfig({
      base_url: "http://h",
      model: "m",
      daily_budget_usd: -1,
      features: {},
    });
    expect(result).toEqual({ base_url: "http://h", model: "m" });
  });
});
