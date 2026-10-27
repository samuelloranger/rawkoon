import { describe, it, expect } from "bun:test";
import {
  installMediaRequestMocks,
  state,
  useMediaRequestHooks,
  type Req,
} from "./mediaRequestsHarness";

installMediaRequestMocks();
const {
  approveRequest,
  deleteLibraryBookWithRequests,
  deleteLibraryMediaWithRequests,
  deleteRequest,
  denyRequest,
} = await import("@rawkoon/api/services/mediaRequests");

useMediaRequestHooks();

describe("approveRequest", () => {
  it("fails when not found", async () => {
    expect(await approveRequest(99, 1, "admin-1")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("adds to library, links it, sets approved, notifies requester", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "X",
      },
    ];
    const r = await approveRequest(1, 3, "admin-1");
    expect(r).toEqual({
      ok: true,
      library_media_id: 909,
      search_queued: true,
      search_skipped_reason: null,
    });
    const row = state.requests[0];
    expect(row.status).toBe("approved");
    expect(row.libraryMediaId).toBe(909);
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_decided" },
    ]);
    // Approving searches right away, like a direct add.
    expect(state.searchQueued).toEqual([909]);
  });

  it("rejects a stale/deleted quality profile without touching the request", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "X",
      },
    ];
    const r = await approveRequest(1, 999, "admin-1"); // 999 not in profiles
    expect(r).toEqual({ ok: false, reason: "invalid_profile" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.notifications).toEqual([]);
  });

  it("adds a book via the book-add flow, links it, sets approved, notifies requester", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "Book X",
        googleVolumeId: "vol-1",
      },
    ];
    const r = await approveRequest(1, 7, "admin-1"); // 7 is a book profile
    expect(r).toEqual({ ok: true });
    const row = state.requests[0];
    expect(row.status).toBe("approved");
    expect(row.bookQualityProfileId).toBe(7);
    expect(row.libraryBookId).toBe(5001);
    expect(state.addedBooks).toEqual([
      { volumeId: "vol-1", bookQualityProfileId: 7 },
    ]);
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_decided" },
    ]);
  });

  it("rejects a stale/deleted book quality profile for a book request", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "Book X",
        googleVolumeId: "vol-1",
      },
    ];
    const r = await approveRequest(1, 999, "admin-1"); // 999 not in bookProfiles
    expect(r).toEqual({ ok: false, reason: "invalid_profile" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.addedBooks).toEqual([]);
    expect(state.notifications).toEqual([]);
  });
});

describe("denyRequest", () => {
  it("sets denied and notifies requester", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "X",
      },
    ];
    const r = await denyRequest(1, "admin-1", "no");
    expect(r).toEqual({ ok: true });
    expect(state.requests[0].status).toBe("denied");
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_decided" },
    ]);
  });
});

describe("deleteRequest", () => {
  function seed(status: string) {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status,
        requestedById: "u1",
        libraryMediaId: null,
        title: "X",
      },
    ];
  }

  for (const status of ["pending", "denied"]) {
    it(`lets the requester delete their own ${status} request`, async () => {
      seed(status);
      expect(await deleteRequest(1, "u1", false)).toEqual({ ok: true });
      expect(state.requests).toEqual([]);
    });

    it(`lets an admin delete someone else's ${status} request`, async () => {
      seed(status);
      expect(await deleteRequest(1, "admin-1", true)).toEqual({ ok: true });
      expect(state.requests).toEqual([]);
    });
  }

  for (const status of ["approved", "available"]) {
    it(`refuses to delete an ${status} request, even for an admin`, async () => {
      seed(status);
      expect(await deleteRequest(1, "u1", false)).toEqual({
        ok: false,
        reason: "not_deletable",
      });
      expect(await deleteRequest(1, "admin-1", true)).toEqual({
        ok: false,
        reason: "not_deletable",
      });
      expect(state.requests).toHaveLength(1);
    });
  }

  it("hides another user's request from a non-admin as not found", async () => {
    seed("pending");
    expect(await deleteRequest(1, "u2", false)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(state.requests).toHaveLength(1);
  });

  it("reports a missing request as not found", async () => {
    expect(await deleteRequest(1, "admin-1", true)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("keeps a request approved between the read and the delete", async () => {
    seed("pending");
    state.beforeDeleteMany = () => {
      state.requests[0].status = "approved";
    };
    expect(await deleteRequest(1, "u1", false)).toEqual({
      ok: false,
      reason: "not_deletable",
    });
    expect(state.requests[0].status).toBe("approved");
  });
});

describe("deleting a library title", () => {
  const req = (over: Partial<Req>): Req => ({
    id: 1,
    tmdbId: 9,
    type: "movie",
    status: "approved",
    requestedById: "u1",
    libraryMediaId: null,
    ...over,
  });

  it("removes a movie or show's request with it", async () => {
    state.requests = [
      req({ id: 1, libraryMediaId: 5 }),
      req({ id: 2, tmdbId: 10, status: "pending" }),
    ];
    await deleteLibraryMediaWithRequests(5);
    expect(state.requests.map((r) => r.id)).toEqual([2]);
    // Requests go first: the title's delete would otherwise null their link.
    expect(state.deletedLibrary).toEqual([
      "requests",
      "media:5",
      "transaction",
    ]);
  });

  it("removes a book's request with it", async () => {
    state.requests = [
      req({ id: 1, type: "book", tmdbId: null, libraryBookId: 7 }),
      req({ id: 2, type: "book", tmdbId: null, libraryBookId: 8 }),
    ];
    await deleteLibraryBookWithRequests(7);
    expect(state.requests.map((r) => r.id)).toEqual([2]);
    expect(state.deletedLibrary).toEqual(["requests", "book:7", "transaction"]);
  });
});
