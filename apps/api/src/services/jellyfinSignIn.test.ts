import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

const realImageService = await import("@rawkoon/api/services/imageService");

type Row = Record<string, unknown>;
const findUnique = mock(async (_args: unknown): Promise<Row | null> => null);
const create = mock(
  async (_args: unknown): Promise<Row> => ({ id: "new-user" }),
);
const updateMany = mock(async (_args: unknown) => ({ count: 1 }));
const saveImage = mock(async (_file: File) => "saved.jpg");

mock.module("@rawkoon/api/db", () => ({
  prisma: { user: { findUnique, create, updateMany } },
}));
mock.module("@rawkoon/api/services/imageService", () => ({
  ...realImageService,
  saveImageAndCreateThumbnail: saveImage,
  getAvatarUrl: (f: string) => `/avatars/${f}`,
}));

const {
  resolveOrCreateJellyfinRawkoonUser,
  copyJellyfinAvatar,
  copyJellyfinAvatars,
} = await import("./jellyfinSignIn");

const base = {
  website_url: "http://jellyfin.test",
  api_key: "admin-key",
  sign_in_enabled: true,
  open_sign_in: false,
};
const open = { ...base, open_sign_in: true };
const jf = { id: "jf-1", name: "viewer", disabled: false };

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const fetchImage = (res: () => Response | Promise<Response>) => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
    res()) as unknown as typeof fetch);
};

beforeEach(() => {
  for (const m of [findUnique, create, updateMany, saveImage]) m.mockClear();
  findUnique.mockImplementation(async () => null);
  create.mockImplementation(async () => ({ id: "new-user" }));
});
afterEach(() => fetchSpy?.mockRestore());

describe("resolveOrCreateJellyfinRawkoonUser", () => {
  it("returns the user linked to the Jellyfin id", async () => {
    findUnique.mockImplementation(async () => ({ id: "u1" }));
    const res = await resolveOrCreateJellyfinRawkoonUser(jf, base);
    expect(res as unknown).toEqual({ status: "ok", user: { id: "u1" } });
    expect(findUnique).toHaveBeenCalledWith({
      where: { jellyfinUserId: "jf-1" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("denies a disabled Jellyfin user even when linked", async () => {
    findUnique.mockImplementation(async () => ({ id: "u1" }));
    const res = await resolveOrCreateJellyfinRawkoonUser(
      { ...jf, disabled: true },
      open,
    );
    expect(res).toEqual({ status: "no_access" });
  });

  it("denies an unlinked user while open sign-in is off", async () => {
    const res = await resolveOrCreateJellyfinRawkoonUser(jf, base);
    expect(res).toEqual({ status: "no_access" });
    expect(create).not.toHaveBeenCalled();
  });

  it("ignores open_sign_in while sign-in itself is off", async () => {
    const res = await resolveOrCreateJellyfinRawkoonUser(jf, {
      ...open,
      sign_in_enabled: false,
    });
    expect(res).toEqual({ status: "no_access" });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a regular, passwordless account under open sign-in", async () => {
    fetchImage(() => new Response(null, { status: 404 }));
    const res = await resolveOrCreateJellyfinRawkoonUser(jf, open);
    expect(res.status).toBe("ok");
    const data = (create.mock.calls[0]![0] as { data: Row }).data;
    expect(data).toMatchObject({
      name: "viewer",
      firstName: "viewer",
      email: "jf-1@jellyfin.invalid",
      isAdmin: false,
      jellyfinUserId: "jf-1",
    });
    expect(data.passwordHash).toBeUndefined();
  });

  it("never matches an existing account by name or email", async () => {
    // Only the jellyfinUserId lookup may resolve a user.
    findUnique.mockImplementation(async (args) => {
      const where = (args as { where: Row }).where;
      return where.jellyfinUserId ? null : { id: "existing-admin" };
    });
    const closed = await resolveOrCreateJellyfinRawkoonUser(
      { ...jf, name: "admin" },
      base,
    );
    expect(closed).toEqual({ status: "no_access" });

    fetchImage(() => new Response(null, { status: 404 }));
    const opened = await resolveOrCreateJellyfinRawkoonUser(
      { ...jf, name: "admin" },
      open,
    );
    expect(opened as unknown).toEqual({
      status: "ok",
      user: { id: "new-user" },
    });
  });

  it("returns the winner of a create race", async () => {
    let lookups = 0;
    findUnique.mockImplementation(async () =>
      ++lookups === 1 ? null : { id: "winner" },
    );
    create.mockImplementation(async () => {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    });
    const res = await resolveOrCreateJellyfinRawkoonUser(jf, open);
    expect(res as unknown).toEqual({ status: "ok", user: { id: "winner" } });
  });

  it("still returns the new account when the avatar copy fails", async () => {
    fetchImage(() => new Response(null, { status: 500 }));
    const res = await resolveOrCreateJellyfinRawkoonUser(jf, open);
    expect(res.status).toBe("ok");
  });
});

describe("copyJellyfinAvatar", () => {
  const image = (type = "image/jpeg", size = 10) =>
    new Response(new Uint8Array(size), {
      status: 200,
      headers: { "content-type": type },
    });

  beforeEach(() => {
    findUnique.mockImplementation(async () => ({ avatarUrl: null }));
  });

  it("sets avatarUrl from a 200 image, only where it is still null", async () => {
    fetchImage(() => image());
    await copyJellyfinAvatar(base, "jf-1", "u1");
    expect(saveImage).toHaveBeenCalledTimes(1);
    expect(saveImage.mock.calls[0]![0].name).toBe("jellyfin.jpg");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "u1", avatarUrl: null },
      data: { avatarUrl: "/avatars/saved.jpg" },
    });
    expect(String(fetchSpy!.mock.calls[0]![0])).toBe(
      "http://jellyfin.test/Users/jf-1/Images/Primary",
    );
  });

  it("does nothing on 404", async () => {
    fetchImage(() => new Response(null, { status: 404 }));
    await copyJellyfinAvatar(base, "jf-1", "u1");
    expect(saveImage).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("swallows a 5xx", async () => {
    fetchImage(() => new Response(null, { status: 503 }));
    await copyJellyfinAvatar(base, "jf-1", "u1");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("swallows a timeout", async () => {
    fetchImage(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await copyJellyfinAvatar(base, "jf-1", "u1");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("ignores a non-image type", async () => {
    fetchImage(() => image("text/html"));
    await copyJellyfinAvatar(base, "jf-1", "u1");
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("ignores an image over 5 MB", async () => {
    fetchImage(() => image("image/png", 5 * 1024 * 1024 + 1));
    await copyJellyfinAvatar(base, "jf-1", "u1");
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("never overwrites an existing avatar", async () => {
    findUnique.mockImplementation(async () => ({ avatarUrl: "/mine.png" }));
    fetchImage(() => image());
    await copyJellyfinAvatar(base, "jf-1", "u1");
    expect(saveImage).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("copyJellyfinAvatars", () => {
  it("copies every avatar with at most four in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch);
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      jellyfinUserId: `jf-${i}`,
      rawkoonUserId: `u-${i}`,
    }));
    await copyJellyfinAvatars(base, pairs);
    expect(fetchSpy).toHaveBeenCalledTimes(10);
    expect(peak).toBe(4);
  });
});
