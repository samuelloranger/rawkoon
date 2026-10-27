import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fakeAdapter } from "../../../test/mocks/downloadClientAdapter";
import type { AddTorrentInput } from "./types";

const net: { fetch: () => Promise<Response> } = {
  fetch: async () => new Response("", { status: 500 }),
};

// Spread the real modules: bun's mock.module is process-global.
const realSafe = await import("@rawkoon/api/utils/medias/safeTorrentFetchUrl");
mock.module("@rawkoon/api/utils/medias/safeTorrentFetchUrl", () => ({
  ...realSafe,
  fetchHttpWithSafeRedirects: () => net.fetch(),
}));
const realHelpers = await import(
  "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers"
);
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers", () => ({
  ...realHelpers,
  prowlarrHeadersForTorrentUrl: () => Promise.resolve({}),
}));

const { sendReleaseToClient } = await import("./sendRelease");
const { MagnetRedirectError } = realSafe;

const HASH = "c".repeat(40);
const magnet = `magnet:?xt=urn:btih:${HASH}&dn=x`;
const base = {
  category: "rawkoon-movies",
  tag: "rawkoon-dh-1",
  savePath: "/dl",
};

const adds: AddTorrentInput[] = [];
const adapter = (add: () => Promise<{ hash: string | null }>) =>
  fakeAdapter({
    addTorrent: async (input) => {
      adds.push(input);
      return add();
    },
  });

describe("sendReleaseToClient", () => {
  beforeEach(() => {
    adds.length = 0;
  });

  it("adds a magnet directly with category, tag and save path", async () => {
    const res = await sendReleaseToClient(
      adapter(async () => ({ hash: null })),
      { ...base, downloadUrl: magnet },
    );
    expect(res).toEqual({ ok: true, hash: HASH });
    expect(adds[0]).toMatchObject({ magnetOrUrl: magnet, ...base });
  });

  it("prefers the hash the client reports over the parsed one", async () => {
    const res = await sendReleaseToClient(
      adapter(async () => ({ hash: "d".repeat(40) })),
      { ...base, downloadUrl: magnet },
    );
    expect(res).toEqual({ ok: true, hash: "d".repeat(40) });
  });

  it("keeps the parsed hash when the client reports an empty one", async () => {
    const res = await sendReleaseToClient(
      adapter(async () => ({ hash: "" })),
      { ...base, downloadUrl: magnet },
    );
    expect(res).toEqual({ ok: true, hash: HASH });
  });

  it("reports an add refusal with the raw error and the known hash", async () => {
    const boom = new Error("409 conflict");
    const res = await sendReleaseToClient(
      adapter(async () => {
        throw boom;
      }),
      { ...base, downloadUrl: magnet },
    );
    expect(res).toEqual({
      ok: false,
      stage: "add",
      error: boom,
      via: "magnet",
      hash: HASH,
    });
  });

  it("fetches a .torrent URL and adds the file", async () => {
    net.fetch = async () => new Response("d4:infod4:name1:xee");
    const res = await sendReleaseToClient(
      adapter(async () => ({ hash: null })),
      { ...base, downloadUrl: "https://idx.example/a.torrent" },
    );
    expect(res.ok).toBe(true);
    expect(adds[0]?.fileName).toBe("release.torrent");
    expect(adds[0]?.fileBuffer).toBeInstanceOf(Uint8Array);
  });

  it("follows an indexer redirect to a magnet", async () => {
    net.fetch = async () => {
      throw new MagnetRedirectError(magnet);
    };
    const res = await sendReleaseToClient(
      adapter(async () => ({ hash: null })),
      { ...base, downloadUrl: "https://idx.example/a.torrent" },
    );
    expect(res).toEqual({ ok: true, hash: HASH });
    expect(adds[0]?.magnetOrUrl).toBe(magnet);
  });

  it("reports a refused .torrent add as coming from the file", async () => {
    net.fetch = async () => new Response("d4:infod4:name1:xee");
    const res = await sendReleaseToClient(
      adapter(async () => {
        throw new Error("rejected");
      }),
      { ...base, downloadUrl: "https://idx.example/a.torrent" },
    );
    expect(res).toMatchObject({ ok: false, stage: "add", via: "file" });
  });

  it("reports a refused redirect add as coming from the magnet", async () => {
    net.fetch = async () => {
      throw new MagnetRedirectError(magnet);
    };
    const res = await sendReleaseToClient(
      adapter(async () => {
        throw new Error("rejected");
      }),
      { ...base, downloadUrl: "https://idx.example/a.torrent" },
    );
    expect(res).toMatchObject({
      ok: false,
      stage: "add",
      via: "magnet",
      hash: HASH,
    });
  });

  it("refuses an oversized .torrent before the client sees it", async () => {
    net.fetch = async () =>
      new Response("x", { headers: { "content-length": String(1e12) } });
    const res = await sendReleaseToClient(
      adapter(async () => ({ hash: null })),
      { ...base, downloadUrl: "https://idx.example/a.torrent" },
    );
    expect(res).toEqual({
      ok: false,
      stage: "fetch",
      message: "Torrent file too large",
    });
    expect(adds).toEqual([]);
  });

  it("reports a failed fetch without touching the client", async () => {
    net.fetch = async () => new Response("", { status: 503 });
    const res = await sendReleaseToClient(
      adapter(async () => ({ hash: null })),
      { ...base, downloadUrl: "https://idx.example/a.torrent" },
    );
    expect(res).toEqual({ ok: false, stage: "fetch", message: "HTTP 503" });
    expect(adds).toEqual([]);
  });
});
