import { beforeEach, describe, expect, it, mock } from "bun:test";

let blocklistEntry: { reason: string | null } | null = null;
let clientConfigured = true;
let urlAllowed = true;
const order: string[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    grabBlocklist: {
      findFirst: async () => {
        order.push("blocklist");
        return blocklistEntry;
      },
    },
  },
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => {
    order.push("client");
    return clientConfigured ? { adapter: {}, savePath: "/d" } : null;
  },
}));
mock.module("@rawkoon/api/utils/medias/safeTorrentFetchUrl", () => ({
  isServerTorrentFetchUrlAllowed: async () => {
    order.push("url");
    return urlAllowed;
  },
  MagnetRedirectError: class extends Error {},
  fetchHttpWithSafeRedirects: async () => new Response(),
}));

const { preflightGrab } = await import("./mediaGrabber/mediaGrabberGrab");

const magnet = `magnet:?xt=urn:btih:${"a".repeat(40)}`;
const reason = async (opts: Parameters<typeof preflightGrab>[0]) => {
  const res = await preflightGrab(opts);
  return "refusal" in res && !res.refusal.grabbed
    ? { reason: res.refusal.reason, refusal: res.refusal.refusal }
    : null;
};

describe("preflightGrab", () => {
  beforeEach(() => {
    blocklistEntry = null;
    clientConfigured = true;
    urlAllowed = true;
    order.length = 0;
  });

  it("refuses an empty URL or title first, with the original messages", async () => {
    expect(await reason({ downloadUrl: " ", releaseTitle: "T" })).toEqual({
      reason: "Missing download URL",
      refusal: undefined,
    });
    expect(await reason({ downloadUrl: magnet, releaseTitle: " " })).toEqual({
      reason: "Missing release title",
      refusal: undefined,
    });
    expect(order).toEqual([]);
  });

  it("refuses an over-long magnet", async () => {
    const long = `magnet:?xt=urn:btih:${"a".repeat(40)}&x=${"b".repeat(17_000)}`;
    expect(
      (await reason({ downloadUrl: long, releaseTitle: "T" }))?.reason,
    ).toBe("Magnet link too long");
  });

  it("refuses a URL that is not allowed, before looking at the client", async () => {
    urlAllowed = false;
    expect(
      await reason({
        downloadUrl: "http://10.0.0.1/x.torrent",
        releaseTitle: "T",
      }),
    ).toEqual({
      reason: "Download URL is not allowed for server-side fetch",
      refusal: undefined,
    });
    expect(order).toEqual(["url"]);
  });

  it("checks URL, then client, then blocklist", async () => {
    blocklistEntry = { reason: null };
    const res = await reason({
      downloadUrl: "https://idx.example/x.torrent",
      releaseTitle: "T",
    });
    expect(order).toEqual(["url", "client", "blocklist"]);
    expect(res).toEqual({
      reason: "Blocklisted: Release is blocklisted",
      refusal: "blocklisted",
    });
  });

  it("refuses when no client is configured, before the blocklist", async () => {
    clientConfigured = false;
    expect(await reason({ downloadUrl: magnet, releaseTitle: "T" })).toEqual({
      reason: "No download client configured",
      refusal: undefined,
    });
    expect(order).toEqual(["client"]);
  });

  it("skips the URL check on request and passes a clean release", async () => {
    const res = await preflightGrab({
      downloadUrl: " https://idx.example/x.torrent ",
      releaseTitle: " T ",
      skipUrlCheck: true,
    });
    expect(order).toEqual(["client", "blocklist"]);
    expect("refusal" in res).toBe(false);
    if (!("refusal" in res)) {
      expect(res.releaseTitle).toBe("T");
      expect(res.isMagnet).toBe(false);
    }
  });
});
