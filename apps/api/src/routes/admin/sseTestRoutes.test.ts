import { beforeEach, describe, expect, it, mock } from "bun:test";

const emitLibraryUpdate = mock((_mediaId: number) => {});
const emitBookUpdate = mock((_bookId: number) => {});

mock.module("@rawkoon/api/services/libraryEvents", () => ({
  emitLibraryUpdate,
  emitBookUpdate,
}));

const { sseTestRoutes } = await import("./sseTestRoutes");
// requireAdmin lives on the admin parent, not here — drive the sub-router directly.
const app = { handle: (req: Request) => sseTestRoutes.fetch(req) };

const post = (body: unknown) =>
  app.handle(
    new Request("http://localhost/sse-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /admin/sse-test", () => {
  beforeEach(() => {
    emitLibraryUpdate.mockClear();
    emitBookUpdate.mockClear();
  });

  it("emits a synthetic library update for kind=media", async () => {
    const res = await post({ kind: "media", id: 42 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, kind: "media", id: 42 });
    expect(emitLibraryUpdate).toHaveBeenCalledWith(42);
    expect(emitBookUpdate).not.toHaveBeenCalled();
  });

  it("emits a synthetic book update for kind=book", async () => {
    const res = await post({ kind: "book", id: 7 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, kind: "book", id: 7 });
    expect(emitBookUpdate).toHaveBeenCalledWith(7);
    expect(emitLibraryUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid kind", async () => {
    const res = await post({ kind: "show", id: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects a missing id", async () => {
    const res = await post({ kind: "media" });
    expect(res.status).toBe(400);
  });
});
