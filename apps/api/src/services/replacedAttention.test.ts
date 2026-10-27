import { describe, expect, it, mock } from "bun:test";

mock.module("@rawkoon/api/db", () => ({ prisma: {} }));
const { alertStillValidFromContext } = await import(
  "./libraryAttention/libraryAttentionSyncValidation"
);
const { REPLACED_FAIL_REASON } = await import("./replacedDownload");

const ctx = (failReason: string | null) =>
  ({
    issueCutoff: new Date(0),
    staleCutoff: new Date(0),
    dhMap: new Map([
      [
        1,
        {
          failed: true,
          failReason,
          postProcessError: null,
          completedAt: null,
          grabbedAt: new Date(),
        },
      ],
    ]),
    mediaMap: new Map(),
    episodeMap: new Map(),
    seasonEpisodes: new Map(),
  }) as unknown as Parameters<typeof alertStillValidFromContext>[1];

const alert = {
  kind: "download_failed",
  scopeType: "media",
  mediaId: 1,
  episodeId: null,
  season: null,
  downloadHistoryId: 1,
};

describe("download_failed attention alerts", () => {
  it("stay valid for a real failure", () => {
    expect(alertStillValidFromContext(alert, ctx("Torrent add failed"))).toBe(
      true,
    );
  });
  it("stay valid for a failed row with no recorded reason", () => {
    expect(alertStillValidFromContext(alert, ctx(null))).toBe(true);
  });
  it("resolve for a download stopped by a replace", () => {
    expect(alertStillValidFromContext(alert, ctx(REPLACED_FAIL_REASON))).toBe(
      false,
    );
  });
});
