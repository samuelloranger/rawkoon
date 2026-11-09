import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const realDb = { ...(await import("@rawkoon/api/db")) };
const realImage = { ...(await import("@rawkoon/api/services/imageService")) };

const deleted: string[] = [];
const updates: unknown[] = [];
const events: string[] = [];
let deleteFails = false;
let saveFails = false;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: {
      findFirst: async () => ({ avatarUrl: "/api/avatars/old.webp" }),
      update: async (a: unknown) => {
        events.push("db");
        updates.push(a);
        return {};
      },
    },
  },
}));
mock.module("@rawkoon/api/services/imageService", () => ({
  ...realImage,
  saveImageAndCreateThumbnail: async () => {
    if (saveFails) throw new Error("sharp failed");
    events.push("save");
    return "new.webp";
  },
  getAvatarUrl: (f: string) => `/api/avatars/${f}`,
  deleteImageFiles: async (f: string) => {
    events.push("delete");
    if (deleteFails) throw new Error("EBUSY");
    deleted.push(f);
  },
}));

const { updateUserAvatarFromUpload } = await import(
  "@rawkoon/api/services/userProfileService"
);

afterAll(() => {
  mock.module("@rawkoon/api/db", () => realDb);
  mock.module("@rawkoon/api/services/imageService", () => realImage);
});

beforeEach(() => {
  deleted.length = 0;
  updates.length = 0;
  events.length = 0;
  saveFails = false;
  deleteFails = false;
});

const file = { type: "image/png", size: 10 };

describe("updateUserAvatarFromUpload", () => {
  it("keeps the old avatar when saving the new image fails", async () => {
    saveFails = true;
    await expect(updateUserAvatarFromUpload("u1", file)).rejects.toThrow();
    expect(deleted).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("deletes the old avatar only after the new one is saved", async () => {
    const r = await updateUserAvatarFromUpload("u1", file);
    expect(r).toEqual({ ok: true, avatarUrl: "/api/avatars/new.webp" });
    expect(updates).toHaveLength(1);
    expect(deleted).toEqual(["old.webp"]);
    expect(events).toEqual(["save", "db", "delete"]);
  });

  it("still succeeds when deleting the old avatar throws", async () => {
    deleteFails = true;
    const r = await updateUserAvatarFromUpload("u1", file);
    expect(r).toEqual({ ok: true, avatarUrl: "/api/avatars/new.webp" });
  });
});
