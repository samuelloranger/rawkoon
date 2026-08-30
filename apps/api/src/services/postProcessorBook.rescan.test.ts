import { beforeEach, describe, expect, mock, test } from "bun:test";

type FindFirstResult = { id: number } | null;

let findFirstResult: FindFirstResult = null;
let createdId = 0;

const findFirst = mock(async () => findFirstResult);
const update = mock(async ({ where }: { where: { id: number } }) => ({
  id: where.id,
}));
const create = mock(async () => ({ id: createdId }));

mock.module("@rawkoon/api/db", () => ({
  prisma: { bookFile: { findFirst, update, create } },
}));

const { upsertBookFile } = await import("./postProcessorBook");

const payload = {
  editionId: 61,
  filePath: "/library/Book/01 - Chapter 1.mp3",
  fileName: "01 - Chapter 1.mp3",
  sizeBytes: 111n,
  format: "mp3" as const,
  durationSecs: 615,
  audioBitrate: 192,
  audioCodec: "mp3",
  languageTags: ["fr"],
  fileDev: "2049",
  fileIno: "830001",
  fileMtimeMs: 1234567n,
};

describe("upsertBookFile", () => {
  beforeEach(() => {
    findFirst.mockClear();
    update.mockClear();
    create.mockClear();
  });

  test("keeps an existing row id and avoids create", async () => {
    findFirstResult = { id: 42 };
    createdId = 5000;

    const result = await upsertBookFile(payload);

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        ...payload,
        scannedAt: expect.any(Date),
        isRetail: false,
      },
    });
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 42, existed: true });
  });

  test("creates a row when none exists and avoids update", async () => {
    findFirstResult = null;
    createdId = 77;

    const result = await upsertBookFile(payload);

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        ...payload,
        isRetail: false,
      },
      select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 77, existed: false });
  });
});
