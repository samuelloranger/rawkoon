import { describe, expect, it } from "bun:test";
import { redactDownloadRow, redactFileRow } from "./libraryRedact";

describe("library redaction", () => {
  it("strips operator detail from download rows", () => {
    const row: Parameters<typeof redactDownloadRow>[0] & { id: number } = {
      id: 1,
      release_title: "Some.Release.1080p",
      indexer: "tracker",
      torrent_hash: "abc",
      fail_reason: "boom",
      post_process_error: "bad",
      post_process_destination_path: "/lib/x",
    };
    const out = redactDownloadRow(row);
    expect(out).toEqual({
      id: 1,
      release_title: "",
      indexer: null,
      torrent_hash: null,
      fail_reason: null,
      post_process_error: null,
      post_process_destination_path: null,
    });
  });

  it("blanks file paths", () => {
    expect(redactFileRow({ id: 2, file_path: "/lib/a.mkv" })).toEqual({
      id: 2,
      file_path: "",
    });
  });
});
