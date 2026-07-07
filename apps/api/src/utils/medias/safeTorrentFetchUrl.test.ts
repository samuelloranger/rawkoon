import { describe, expect, test } from "bun:test";
import { isHttpUrlSafeForServerTorrentFetch } from "./safeTorrentFetchUrl";

describe("isHttpUrlSafeForServerTorrentFetch", () => {
  test("allows normal https URLs", () => {
    expect(
      isHttpUrlSafeForServerTorrentFetch("https://example.com/file.torrent"),
    ).toBe(true);
  });

  test("allows private LAN hosts (homelab indexers)", () => {
    expect(
      isHttpUrlSafeForServerTorrentFetch("http://192.168.1.50/torrent"),
    ).toBe(true);
  });

  test("blocks localhost", () => {
    expect(
      isHttpUrlSafeForServerTorrentFetch("http://localhost/a.torrent"),
    ).toBe(false);
  });

  test("blocks loopback IPv4", () => {
    expect(
      isHttpUrlSafeForServerTorrentFetch("http://127.0.0.1/a.torrent"),
    ).toBe(false);
  });

  test("blocks cloud metadata endpoint", () => {
    expect(
      isHttpUrlSafeForServerTorrentFetch(
        "http://169.254.169.254/latest/meta-data",
      ),
    ).toBe(false);
  });

  test("blocks non-http protocols", () => {
    expect(isHttpUrlSafeForServerTorrentFetch("file:///etc/passwd")).toBe(
      false,
    );
    expect(isHttpUrlSafeForServerTorrentFetch("ftp://x/y")).toBe(false);
  });
});
