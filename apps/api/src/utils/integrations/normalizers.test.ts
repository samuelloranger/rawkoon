import { describe, expect, test } from "bun:test";
import {
  AUDNEXUS_DEFAULT_BASE_URL,
  AUDNEXUS_DEFAULT_REGION,
  normalizeAudnexusConfig,
} from "@rawkoon/api/utils/integrations/normalizers";

describe("normalizeAudnexusConfig", () => {
  /**
   * Unlike Google Books, Audnexus needs no key: the public instance is
   * keyless, so an empty config is fully usable and must normalize to the
   * defaults rather than to null.
   */
  test("defaults an empty config to the public instance", () => {
    expect(normalizeAudnexusConfig({})).toEqual({
      base_url: AUDNEXUS_DEFAULT_BASE_URL,
      region: AUDNEXUS_DEFAULT_REGION,
    });
  });

  test("keeps a self-hosted base URL and strips its trailing slash", () => {
    expect(
      normalizeAudnexusConfig({
        base_url: "http://audnexus.lan:3000/",
        region: "fr",
      }),
    ).toEqual({ base_url: "http://audnexus.lan:3000", region: "fr" });
  });

  test("rejects a non-http base URL", () => {
    expect(
      normalizeAudnexusConfig({ base_url: "file:///etc/passwd" }),
    ).toBeNull();
    expect(normalizeAudnexusConfig({ base_url: "not a url" })).toBeNull();
  });

  test("falls back to the default region for an unknown one", () => {
    expect(normalizeAudnexusConfig({ region: "atlantis" })?.region).toBe(
      AUDNEXUS_DEFAULT_REGION,
    );
  });

  test("normalizes region case and whitespace", () => {
    expect(normalizeAudnexusConfig({ region: "  FR " })?.region).toBe("fr");
  });

  test("returns null for a non-object config", () => {
    expect(normalizeAudnexusConfig(null)).toBeNull();
    expect(normalizeAudnexusConfig([])).toBeNull();
  });
});
