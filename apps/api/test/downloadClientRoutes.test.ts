import { describe, expect, it } from "bun:test";
import {
  buildDownloadClientIntegrationView,
  computeHookStatus,
} from "@rawkoon/api/routes/integrations/downloadClient";

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

describe("computeHookStatus", () => {
  const nowMs = 1_800_000_000_000;

  it("reports not-configured without a callback URL", () => {
    expect(
      computeHookStatus({
        callbackUrl: null,
        lastSeenAt: null,
        foreignProgram: false,
        nowMs,
      }),
    ).toBe("not-configured");
  });

  it("reports awaiting-first once configured but never called", () => {
    expect(
      computeHookStatus({
        callbackUrl: "http://rawkoon:3000",
        lastSeenAt: null,
        foreignProgram: false,
        nowMs,
      }),
    ).toBe("awaiting-first");
  });

  it("reports active for a recent hook", () => {
    expect(
      computeHookStatus({
        callbackUrl: "http://rawkoon:3000",
        lastSeenAt: new Date(nowMs - 60_000),
        foreignProgram: false,
        nowMs,
      }),
    ).toBe("active");
  });

  it("reports stale for a hook older than the window", () => {
    expect(
      computeHookStatus({
        callbackUrl: "http://rawkoon:3000",
        lastSeenAt: new Date(nowMs - 25 * 60 * 60 * 1000),
        foreignProgram: false,
        nowMs,
      }),
    ).toBe("stale");
  });

  it("surfaces a foreign autorun program over every other state", () => {
    expect(
      computeHookStatus({
        callbackUrl: "http://rawkoon:3000",
        lastSeenAt: new Date(nowMs - 60_000),
        foreignProgram: true,
        nowMs,
      }),
    ).toBe("foreign-program");
  });
});
