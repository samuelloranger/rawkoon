/** The endpoint every client hook posts to. Also the autorun ownership marker. */
export const HOOK_PATH = "/api/download-client/hook/complete";

const normalizeBase = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

/**
 * qBittorrent's "run external program on torrent finished" command.
 *
 * qBittorrent parses this argv itself rather than invoking a shell, so it must
 * contain no shell metacharacters. `%I` is its info-hash substitution.
 */
export function buildQbittorrentCommand(input: {
  baseUrl: string;
  token: string;
}): string {
  const url = `${normalizeBase(input.baseUrl)}${HOOK_PATH}?hash=%I`;
  return `curl -fsS -m 10 -X POST -H "X-Rawkoon-Token: ${input.token}" "${url}"`;
}

/**
 * Script for Deluge's bundled Execute plugin ("Torrent Complete").
 *
 * Execute takes an executable path, not an inline command, and passes
 * torrent_id, torrent_name, torrent_path as $1 $2 $3. A Deluge torrent id is
 * the info hash.
 */
export function buildDelugeScript(input: {
  baseUrl: string;
  token: string;
}): string {
  const base = normalizeBase(input.baseUrl);
  return `#!/bin/sh
# Rawkoon download completion hook (Deluge Execute plugin)
hash="$1"
curl -fsS -m 10 -X POST \\
  -H "X-Rawkoon-Token: ${input.token}" \\
  "${base}${HOOK_PATH}?hash=$hash"
`;
}

/**
 * Script for Transmission's `script-torrent-done-filename`.
 *
 * Transmission exposes the info hash as TR_TORRENT_HASH in the environment.
 */
export function buildTransmissionScript(input: {
  baseUrl: string;
  token: string;
}): string {
  const base = normalizeBase(input.baseUrl);
  return `#!/bin/sh
# Rawkoon download completion hook (Transmission script-torrent-done)
curl -fsS -m 10 -X POST \\
  -H "X-Rawkoon-Token: ${input.token}" \\
  "${base}${HOOK_PATH}?hash=$TR_TORRENT_HASH"
`;
}
