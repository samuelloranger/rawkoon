import { describe, expect, it } from "bun:test";
import { normalizeDownloadClientConfig } from "@rawkoon/api/services/downloadClient/config";
import { encrypt } from "@rawkoon/api/services/crypto";

describe("normalizeDownloadClientConfig", () => {
  it("decrypts password and strips trailing slash", () => {
    const cfg = normalizeDownloadClientConfig(
      {
        website_url: "http://localhost:8080/",
        username: "admin",
        password: encrypt("secret"),
        label: "rawkoon",
      },
      "qbittorrent",
    );

    expect(cfg).toEqual({
      website_url: "http://localhost:8080",
      username: "admin",
      password: "secret",
      label: "rawkoon",
      save_path: undefined,
    });
  });

  it("returns null when required fields are missing", () => {
    expect(
      normalizeDownloadClientConfig({ website_url: "x" }, "qbittorrent"),
    ).toBeNull();
  });

  it("allows a blank Deluge username", () => {
    const cfg = normalizeDownloadClientConfig(
      {
        website_url: "http://localhost:8112",
        username: "",
        password: encrypt("dpass"),
        label: "rawkoon",
      },
      "deluge",
    );

    expect(cfg?.username).toBe("");
    expect(cfg?.password).toBe("dpass");
  });
});
