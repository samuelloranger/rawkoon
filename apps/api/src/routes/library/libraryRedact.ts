// Non-admins get the row shape without operator-side detail; required string
// fields blank out (not null) so older clients still decode them.
export const redactDownloadRow = <
  T extends {
    release_title: string;
    indexer: string | null;
    torrent_hash: string | null;
    fail_reason: string | null;
    post_process_error: string | null;
    post_process_destination_path: string | null;
  },
>(
  row: T,
): T => ({
  ...row,
  release_title: "",
  indexer: null,
  torrent_hash: null,
  fail_reason: null,
  post_process_error: null,
  post_process_destination_path: null,
});

export const redactFileRow = <T extends { file_path: string }>(row: T): T => ({
  ...row,
  file_path: "",
});
