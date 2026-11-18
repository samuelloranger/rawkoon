import { beforeEach, describe, expect, it, mock } from "bun:test";
import { prismaMock, clearPrismaMocks } from "../../../test/mocks/prisma";

mock.module("@rawkoon/api/db", () => ({ prisma: prismaMock }));

const run = async (
  tracks: { language: string; title?: string | null }[] | null,
  episodeId: number | null = null,
) => {
  const { syncAudioLanguageAlert } = await import(
    "@rawkoon/api/services/libraryAttention/audioLanguageAlert"
  );
  await syncAudioLanguageAlert({
    mediaId: 7,
    episodeId,
    tracks: (tracks?.map((t, index) => ({
      index,
      title: null,
      codec: null,
      channels: null,
      channel_layout: null,
      bitrate_kbps: null,
      default: false,
      forced: false,
      language_name: t.language,
      ...t,
    })) ?? null) as never,
  });
};

const withProfile = (preferredLanguages: string[]) =>
  prismaMock.libraryMedia.findUnique.mockImplementationOnce(async () => ({
    title: "Some Movie",
    qualityProfile: { preferredLanguages },
  }));

describe("syncAudioLanguageAlert", () => {
  beforeEach(() => clearPrismaMocks());

  it("creates a mismatch alert naming title, file and preferred languages", async () => {
    withProfile(["VFF"]);
    await run([{ language: "eng" }]);
    const arg = prismaMock.libraryAttentionAlert.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data).toMatchObject({
      mediaId: 7,
      scopeType: "movie",
      kind: "audio_language_mismatch",
      status: "open",
    });
    expect(arg.data.detail).toBe(
      '"Some Movie": file audio is eng; profile prefers VFF.',
    );
  });

  it("raises the soft kind for France-French audio under a VFQ profile", async () => {
    withProfile(["VFQ"]);
    await run([{ language: "fre", title: "VFF" }], 3);
    const arg = prismaMock.libraryAttentionAlert.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data).toMatchObject({
      scopeType: "episode",
      episodeId: 3,
      kind: "audio_language_warn",
    });
  });

  it("updates the open alert instead of duplicating it", async () => {
    withProfile(["VFF"]);
    prismaMock.libraryAttentionAlert.findFirst.mockImplementationOnce(
      async () => ({ id: 42 }),
    );
    await run([{ language: "eng" }]);
    expect(prismaMock.libraryAttentionAlert.create).not.toHaveBeenCalled();
    expect(prismaMock.libraryAttentionAlert.update).toHaveBeenCalledTimes(1);
  });

  it("resolves an open alert when the new file passes", async () => {
    withProfile(["VFF"]);
    await run([{ language: "fre" }]);
    expect(prismaMock.libraryAttentionAlert.create).not.toHaveBeenCalled();
    expect(prismaMock.libraryAttentionAlert.updateMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it("does nothing visible when the profile has no preferred languages", async () => {
    withProfile([]);
    await run([{ language: "eng" }]);
    expect(prismaMock.libraryAttentionAlert.create).not.toHaveBeenCalled();
  });

  it("does not recreate an alert the user dismissed for the same detail", async () => {
    withProfile(["VFF"]);
    prismaMock.libraryAttentionAlert.findFirst
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => ({ id: 9 }));
    await run([{ language: "eng" }]);
    expect(prismaMock.libraryAttentionAlert.create).not.toHaveBeenCalled();
    const where = (
      prismaMock.libraryAttentionAlert.findFirst.mock.calls[1]![0] as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(where).toMatchObject({
      status: "dismissed",
      kind: "audio_language_mismatch",
    });
  });

  it("resolves open alerts when media info is unavailable", async () => {
    await run(null);
    expect(prismaMock.libraryAttentionAlert.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(prismaMock.libraryAttentionAlert.create).not.toHaveBeenCalled();
    expect(prismaMock.libraryMedia.findUnique).not.toHaveBeenCalled();
  });
});
