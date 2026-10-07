import { fakeDns } from "../testDnsMock";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  fetchHttpWithSafeRedirects,
  isServerTorrentFetchUrlAllowed,
  MagnetRedirectError,
} from "./safeTorrentFetchUrl";

fakeDns.set("public.test", ["93.184.216.34"]);
fakeDns.set("rebind.test", ["127.0.0.1"]);
fakeDns.set("indexer.lan", ["192.168.1.20"]);
fakeDns.set("prowlarr", ["172.20.0.3"]);
fakeDns.set("meta.test", ["169.254.169.254"]);
fakeDns.set("nx.test", new Error("getaddrinfo ENOTFOUND nx.test"));
afterAll(() => fakeDns.clear());

describe("isServerTorrentFetchUrlAllowed", () => {
  test("allows normal https URLs", async () => {
    expect(
      await isServerTorrentFetchUrlAllowed("https://public.test/file.torrent"),
    ).toBe(true);
  });

  test("allows private LAN hosts (homelab indexers)", async () => {
    expect(
      await isServerTorrentFetchUrlAllowed("http://192.168.1.50/torrent"),
    ).toBe(true);
    expect(
      await isServerTorrentFetchUrlAllowed("http://indexer.lan/torrent"),
    ).toBe(true);
    expect(await isServerTorrentFetchUrlAllowed("http://prowlarr:9696/x")).toBe(
      true,
    );
  });

  test("blocks localhost", async () => {
    expect(
      await isServerTorrentFetchUrlAllowed("http://localhost/a.torrent"),
    ).toBe(false);
  });

  test("blocks loopback IPv4", async () => {
    expect(
      await isServerTorrentFetchUrlAllowed("http://127.0.0.1/a.torrent"),
    ).toBe(false);
  });

  test("blocks cloud metadata endpoint", async () => {
    expect(
      await isServerTorrentFetchUrlAllowed(
        "http://169.254.169.254/latest/meta-data",
      ),
    ).toBe(false);
  });

  test("blocks hostnames that resolve to loopback or link-local", async () => {
    expect(await isServerTorrentFetchUrlAllowed("http://rebind.test/a")).toBe(
      false,
    );
    expect(await isServerTorrentFetchUrlAllowed("http://meta.test/a")).toBe(
      false,
    );
  });

  test("blocks IPv6 literals that wrap loopback or link-local", async () => {
    for (const u of [
      "http://[::ffff:7f00:1]/a",
      "http://[::ffff:127.0.0.1]/a",
      "http://[fe80::1]/a",
      "http://[::1]/a",
      "http://[64:ff9b::7f00:1]/a",
      "http://[2002:7f00:1::]/a",
    ]) {
      expect(await isServerTorrentFetchUrlAllowed(u)).toBe(false);
    }
  });

  test("fails closed on unresolvable hosts", async () => {
    expect(await isServerTorrentFetchUrlAllowed("http://nx.test/a")).toBe(
      false,
    );
  });

  test("blocks non-http protocols", async () => {
    expect(await isServerTorrentFetchUrlAllowed("file:///etc/passwd")).toBe(
      false,
    );
    expect(await isServerTorrentFetchUrlAllowed("ftp://x/y")).toBe(false);
  });
});

describe("fetchHttpWithSafeRedirects", () => {
  const realFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit }[] = [];
  let responses: Response[] = [];
  const redirect = (status: number, location: string) =>
    new Response(null, { status, headers: { location } });

  beforeEach(() => {
    calls = [];
    responses = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return responses.shift() ?? new Response("torrent-bytes");
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("connects to the validated LAN IP, not a re-resolved name", async () => {
    await fetchHttpWithSafeRedirects("http://prowlarr:9696/dl/1", {});
    expect(calls[0].url).toBe("http://172.20.0.3:9696/dl/1");
    expect((calls[0].init.headers as Headers).get("host")).toBe(
      "prowlarr:9696",
    );
  });

  test("drops the indexer API key when a redirect leaves the origin", async () => {
    responses = [redirect(302, "https://public.test/real.torrent")];
    await fetchHttpWithSafeRedirects("http://prowlarr:9696/dl/1", {
      headers: { "X-Api-Key": "secret", "User-Agent": "rawkoon" },
    });
    expect((calls[0].init.headers as Headers).get("x-api-key")).toBe("secret");
    const second = calls[1].init.headers as Headers;
    expect(second.has("x-api-key")).toBe(false);
    expect(second.get("user-agent")).toBe("rawkoon");
  });

  test("keeps the API key on a same-origin redirect", async () => {
    responses = [redirect(302, "/dl/1/file")];
    await fetchHttpWithSafeRedirects("http://prowlarr:9696/dl/1", {
      headers: { "X-Api-Key": "secret" },
    });
    expect((calls[1].init.headers as Headers).get("x-api-key")).toBe("secret");
  });

  test("rejects a redirect to loopback", async () => {
    responses = [redirect(302, "http://rebind.test/x")];
    await expect(
      fetchHttpWithSafeRedirects("http://prowlarr:9696/dl/1", {}),
    ).rejects.toThrow("blocked");
    expect(calls).toHaveLength(1);
  });

  test("throws MagnetRedirectError on a magnet redirect", async () => {
    const magnet = "magnet:?xt=urn:btih:abc";
    responses = [redirect(302, magnet)];
    const err = await fetchHttpWithSafeRedirects(
      "http://prowlarr:9696/dl/1",
      {},
    ).catch((e) => e);
    expect(err).toBeInstanceOf(MagnetRedirectError);
    expect((err as MagnetRedirectError).magnetUrl).toBe(magnet);
  });

  test("keeps the API key when the indexer upgrades http to https", async () => {
    responses = [redirect(301, "https://prowlarr:9696/dl/1")];
    await fetchHttpWithSafeRedirects("http://prowlarr:9696/dl/1", {
      headers: { "X-Api-Key": "secret" },
    });
    expect((calls[1].init.headers as Headers).get("x-api-key")).toBe("secret");
  });

  test("prefers the IPv4 answer of a dual-stack LAN host", async () => {
    fakeDns.set("dual.lan.test", ["fd00::10", "192.168.1.20"]);
    await fetchHttpWithSafeRedirects("http://dual.lan.test/x", {});
    expect(calls[0].url).toBe("http://192.168.1.20/x");
  });
});
