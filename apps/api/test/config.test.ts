import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { getBaseUrl, loadConfig, resetConfig } from "../src/config";

describe("Config", () => {
  const originalEnv = { ...Bun.env };

  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
    Object.assign(Bun.env, originalEnv);
  });

  describe("loadConfig", () => {
    it("should default IMAGE_STORAGE_DIR to ./data/images", () => {
      delete Bun.env.IMAGE_STORAGE_DIR;
      const config = loadConfig();
      expect(config.IMAGE_STORAGE_DIR).toBe("./data/images");
    });

    it("should honor IMAGE_STORAGE_DIR when set", () => {
      Bun.env.IMAGE_STORAGE_DIR = "/var/custom/images";
      const config = loadConfig();
      expect(config.IMAGE_STORAGE_DIR).toBe("/var/custom/images");
    });
  });

  describe("getBaseUrl", () => {
    it("should return default URL when not configured", () => {
      delete Bun.env.BASE_URL;
      const url = getBaseUrl();
      expect(url).toBe("http://localhost:3000");
    });

    it("should return configured URL", () => {
      Bun.env.BASE_URL = "https://example.com";
      const url = getBaseUrl();
      expect(url).toBe("https://example.com");
    });
  });
});
