import { describe, it, expect } from "bun:test";
import {
  installMediaRequestMocks,
  state,
  useMediaRequestHooks,
} from "./mediaRequestsHarness";

installMediaRequestMocks();
const { notifyRequestAvailable, notifyBookRequestAvailable } = await import(
  "@rawkoon/api/services/mediaRequests"
);

useMediaRequestHooks();

describe("notifyRequestAvailable", () => {
  it("flips approved request to available and notifies requester", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: 909,
        title: "X",
      },
    ];
    state.mediaStatusById = { 909: "downloaded" };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("available");
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_available" },
    ]);
  });

  it("does not flip while the media is not yet complete (e.g. one show episode)", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "show",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: 909,
        title: "X",
      },
    ];
    // ongoing show: downloaded as far as acquisition goes, but still airing
    state.mediaStatusById = { 909: "downloaded" };
    state.mediaTmdbStatusById = { 909: "Returning Series" };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("approved");
    expect(state.notifications).toEqual([]);
  });

  it("flips a show request once the show has ended", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "show",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: 909,
        title: "X",
      },
    ];
    state.mediaStatusById = { 909: "downloaded" };
    state.mediaTmdbStatusById = { 909: "Ended" };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("available");
  });

  it("is a no-op when no approved request links to the media", async () => {
    await notifyRequestAvailable(123);
    expect(state.notifications).toEqual([]);
  });
});

describe("notifyBookRequestAvailable", () => {
  it("flips an approved book request to available once an edition lands", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: null,
        libraryBookId: 5001,
        title: "Book X",
      },
    ];
    state.bookEditionStatusByBookId = { 5001: "downloaded" };
    await notifyBookRequestAvailable(5001);
    expect(state.requests[0].status).toBe("available");
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_available" },
    ]);
  });

  it("does not flip while no edition of the book has finished downloading", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: null,
        libraryBookId: 5001,
        title: "Book X",
      },
    ];
    state.bookEditionStatusByBookId = { 5001: "wanted" };
    await notifyBookRequestAvailable(5001);
    expect(state.requests[0].status).toBe("approved");
    expect(state.notifications).toEqual([]);
  });

  it("is a no-op when no approved request links to the book", async () => {
    await notifyBookRequestAvailable(9999);
    expect(state.notifications).toEqual([]);
  });
});
