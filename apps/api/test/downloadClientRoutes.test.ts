import { describe, expect, it } from "bun:test";
import { buildDownloadClientIntegrationView } from "@rawkoon/api/routes/integrations/downloadClient";

describe("buildDownloadClientIntegrationView", () => {
  it("redacts the stored password", () => {
    const view = buildDownloadClientIntegrationView({
      enabled: true,
      config: {
        client_type: "transmission",
        website_url: "http://localhost:9091",
        username: "admin",
        password: "ENCRYPTED",
        label: "rawkoon",
      },
    });

    expect(view).toEqual({
      type: "download-client",
      enabled: true,
      client_type: "transmission",
      website_url: "http://localhost:9091",
      username: "admin",
      password_set: true,
      label: "rawkoon",
      save_path: undefined,
    });
    expect(JSON.stringify(view)).not.toContain("ENCRYPTED");
  });

  it("reports an absent password", () => {
    expect(
      buildDownloadClientIntegrationView({
        enabled: false,
        config: {
          client_type: "qbittorrent",
          website_url: "",
          username: "",
          label: "rawkoon",
        },
      }).password_set,
    ).toBe(false);
  });
});
