import { describe, it, expect } from "bun:test";
import { normalizeLocalAiConfig } from "@rawkoon/api/utils/integrations/normalizers";

describe("normalizeLocalAiConfig", () => {
  it("returns null for null input", () => {
    expect(normalizeLocalAiConfig(null)).toBeNull();
  });

  it("returns null when base_url is missing", () => {
    expect(normalizeLocalAiConfig({ model: "llama3.2" })).toBeNull();
  });

  it("returns null when model is missing", () => {
    expect(
      normalizeLocalAiConfig({ base_url: "http://localhost:11434" }),
    ).toBeNull();
  });

  it("returns config with trimmed trailing slash on base_url", () => {
    const result = normalizeLocalAiConfig({
      base_url: "http://homelab:11434/",
      model: "llama3.2",
    });
    expect(result).toEqual({
      base_url: "http://homelab:11434",
      model: "llama3.2",
    });
  });

  it("returns config as-is when valid", () => {
    const result = normalizeLocalAiConfig({
      base_url: "http://homelab:11434",
      model: "mistral",
    });
    expect(result).toEqual({
      base_url: "http://homelab:11434",
      model: "mistral",
    });
  });
});
