import { fakeDns } from "../testDnsMock";
import { describe, expect, test } from "bun:test";
import { isServerTorrentFetchUrlAllowed } from "./safeTorrentFetchUrl";

fakeDns.set("example.com", ["93.184.216.34"]);
fakeDns.set("rebind.test", ["127.0.0.1"]);
fakeDns.set("indexer.lan", ["192.168.1.20"]);
fakeDns.set("prowlarr", ["172.20.0.3"]);
fakeDns.set("meta.test", ["169.254.169.254"]);

describe("isServerTorrentFetchUrlAllowed", () => {
  test("allows normal https URLs", async () => {
    expect(
      await isServerTorrentFetchUrlAllowed("https://example.com/file.torrent"),
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
    fakeDns.delete("nx.invalid");
    expect(await isServerTorrentFetchUrlAllowed("http://nx.invalid/a")).toBe(
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
