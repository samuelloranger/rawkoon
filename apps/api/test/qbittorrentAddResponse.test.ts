import { describe, it, expect, spyOn } from "bun:test";

import { parseQbittorrentAddResponse } from "@rawkoon/api/services/qbittorrent/parseAddResponse";

// Regression tests for the qBittorrent torrents/add response parser.
// History: qBit 5.x switched from plain "Ok." to a JSON envelope. The pre-fix
// parser only accepted "Ok." which caused every successful 5.x add to be
// reported as a rejection — DownloadHistory rows landed with failed=true and
// torrent_hash=NULL even though qBit had the torrent.

describe("parseQbittorrentAddResponse", () => {
  it("accepts the legacy <=4.x 'Ok.' sentinel", () => {
    expect(parseQbittorrentAddResponse("Ok.")).toEqual({ ok: true });
    expect(parseQbittorrentAddResponse("ok")).toEqual({ ok: true });
    expect(parseQbittorrentAddResponse("  Ok.\n")).toEqual({ ok: true });
  });

  it("accepts the qBittorrent 5.x JSON success envelope (success_count > 0)", () => {
    const body = JSON.stringify({
      added_torrent_ids: ["a".repeat(40)],
      failure_count: 0,
      pending_count: 0,
      success_count: 1,
    });
    expect(parseQbittorrentAddResponse(body)).toEqual({ ok: true });
  });

  it("accepts the qBittorrent 5.x JSON envelope when only added_torrent_ids is populated", () => {
    const body = JSON.stringify({
      added_torrent_ids: ["a".repeat(40)],
      failure_count: 0,
      pending_count: 0,
    });
    expect(parseQbittorrentAddResponse(body)).toEqual({ ok: true });
  });

  it("rejects the qBittorrent 5.x JSON envelope when nothing was added", () => {
    const body = JSON.stringify({
      added_torrent_ids: [],
      failure_count: 1,
      pending_count: 0,
      success_count: 0,
    });
    const result = parseQbittorrentAddResponse(body);
    expect(result.ok).toBe(false);
  });

  it("rejects an arbitrary error body and reports the trimmed text", () => {
    const result = parseQbittorrentAddResponse("Torrent is not parsable.\n");
    expect(result).toEqual({ ok: false, error: "Torrent is not parsable." });
  });

  it("logs raw length + hex32 when JSON.parse fails on an almost-JSON body", () => {
    // Non-JSON body that starts with `{` — exercises the catch branch.
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Truncated JSON — valid prefix but unterminated.
      const result = parseQbittorrentAddResponse('{"added_torrent_ids":[');
      expect(result.ok).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(message).toContain("[parseQbittorrentAddResponse]");
      expect(message).toContain("len=");
      expect(message).toContain("hex32=");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
