import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";

/** A do-nothing download client; override only the calls a test exercises. */
export function fakeAdapter(
  overrides: Partial<DownloadClientAdapter> = {},
): DownloadClientAdapter {
  return {
    type: "qbittorrent",
    testConnection: async () => ({ ok: true }),
    addTorrent: async () => ({ hash: null }),
    listTorrents: async () => [],
    getTorrent: async () => null,
    listFiles: async () => null,
    pause: async () => {},
    resume: async () => {},
    remove: async () => {},
    ...overrides,
  };
}
