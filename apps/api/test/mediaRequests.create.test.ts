import { describe, it, expect } from "bun:test";
import {
  installMediaRequestMocks,
  state,
  useMediaRequestHooks,
} from "./mediaRequestsHarness";

installMediaRequestMocks();
const { createRequest } = await import("@rawkoon/api/services/mediaRequests");

useMediaRequestHooks();

describe("createRequest", () => {
  it("rejects when title already in library", async () => {
    state.library = [{ tmdbId: 5 }];
    const r = await createRequest({
      tmdbId: 5,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: false, reason: "exists_in_library" });
  });

  it("rejects a duplicate request", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 7,
        type: "movie",
        status: "pending",
        requestedById: "u2",
        libraryMediaId: null,
      },
    ];
    const r = await createRequest({
      tmdbId: 7,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: false, reason: "already_requested" });
  });

  it("creates and notifies admins", async () => {
    const r = await createRequest({
      tmdbId: 9,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("reopens a denied request", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "denied",
        requestedById: "u2",
        libraryMediaId: null,
      },
    ];
    const r = await createRequest({
      tmdbId: 9,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.requests[0].requestedById).toBe("u1");
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("reopens an approved request whose title left the library", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "approved",
        requestedById: "u2",
        libraryMediaId: null,
      },
    ];
    const r = await createRequest({
      tmdbId: 9,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.requests[0].requestedById).toBe("u1");
  });

  it("rejects a book already in the library", async () => {
    state.libraryBooks = [{ googleVolumeId: "vol-1" }];
    const r = await createRequest({
      type: "book",
      googleVolumeId: "vol-1",
      title: "Book X",
      author: "Author X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: false, reason: "exists_in_library" });
  });

  it("creates a book request and notifies admins", async () => {
    const r = await createRequest({
      type: "book",
      googleVolumeId: "vol-2",
      title: "Book Y",
      author: "Author Y",
      posterUrl: null,
      year: 2020,
      userId: "u1",
    });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0]).toMatchObject({
      type: "book",
      googleVolumeId: "vol-2",
      title: "Book Y",
    });
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("rejects a duplicate book request by volume id", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "pending",
        requestedById: "u2",
        libraryMediaId: null,
        googleVolumeId: "vol-3",
      },
    ];
    const r = await createRequest({
      type: "book",
      googleVolumeId: "vol-3",
      title: "Book Z",
      author: null,
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: false, reason: "already_requested" });
  });

  it("reopens an approved book request whose book was removed", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "approved",
        requestedById: "u2",
        libraryMediaId: null,
        googleVolumeId: "vol-4",
      },
    ];
    const r = await createRequest({
      type: "book",
      googleVolumeId: "vol-4",
      title: "Book W",
      author: null,
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toMatchObject({ ok: true, id: 1 });
    expect(state.requests[0].status).toBe("pending");
    expect(state.requests[0].requestedById).toBe("u1");
  });
});

describe("createRequest by an admin", () => {
  const adminMovie = {
    tmdbId: 9,
    type: "movie" as const,
    title: "X",
    posterUrl: null,
    year: null,
    userId: "admin-1",
    autoApprove: true,
  };

  it("approves on the spot with the default profile, without notifying anyone", async () => {
    state.defaultProfiles.movie = 3;
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "approved" });
    const row = state.requests[0] as Req & { decidedById?: string };
    expect(row.status).toBe("approved");
    expect(row.libraryMediaId).toBe(909);
    expect(row.decidedById).toBe("admin-1");
    expect(state.notifications).toEqual([]);
  });

  it("stays pending when no default profile is set", async () => {
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("stays pending when the default profile no longer exists", async () => {
    state.defaultProfiles.movie = 42;
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
  });

  it("uses the show default for a show", async () => {
    state.defaultProfiles.movie = 3;
    const r = await createRequest({ ...adminMovie, type: "show" });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    state.requests = [];
    state.defaultProfiles.show = 1;
    const r2 = await createRequest({ ...adminMovie, type: "show" });
    expect(r2).toEqual({ ok: true, id: 1, status: "approved" });
  });

  it("approves a reopened denied request", async () => {
    state.defaultProfiles.movie = 3;
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "denied",
        requestedById: "u2",
        libraryMediaId: null,
        title: "X",
      },
    ];
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "approved" });
    expect(state.requests[0].status).toBe("approved");
    expect(state.requests[0].requestedById).toBe("admin-1");
  });

  it("falls back to pending and notifies admins when the approval throws", async () => {
    state.defaultProfiles.movie = 3;
    state.failLibraryAdd = true;
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("leaves a non-admin request pending even with a default profile", async () => {
    state.defaultProfiles.movie = 3;
    const r = await createRequest({
      ...adminMovie,
      userId: "u1",
      autoApprove: false,
    });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
  });
});
