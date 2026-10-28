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

  const showRequest = () => [
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
  const PAST = new Date("2020-01-01");
  const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const ep = (
    season: number,
    status: string,
    airDate: Date | null = PAST,
    monitored = true,
  ) => ({ season, status, airDate, monitored });

  it("flips an airing show whose aired episodes are all downloaded while future ones are pending", async () => {
    state.requests = showRequest();
    state.mediaStatusById = { 909: "wanted" };
    state.mediaTmdbStatusById = { 909: "Returning Series" };
    state.episodesByMediaId = {
      909: [
        ep(1, "downloaded"),
        ep(1, "upgrading"),
        ep(2, "wanted", FUTURE),
        ep(2, "wanted", null),
      ],
    };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("available");
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_available" },
    ]);
  });

  it("stays approved when an aired season is still missing, even for an ended show with a show-level downloaded status", async () => {
    state.requests = showRequest();
    // a finished season pack marks the show downloaded while season 2 is missing
    state.mediaStatusById = { 909: "downloaded" };
    state.mediaTmdbStatusById = { 909: "Ended" };
    state.episodesByMediaId = {
      909: [ep(1, "downloaded"), ep(1, "downloaded"), ep(2, "wanted")],
    };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("approved");
    expect(state.notifications).toEqual([]);
  });

  it("stays approved while an aired episode is downloading or skipped", async () => {
    state.requests = showRequest();
    state.mediaStatusById = { 909: "downloaded" };
    state.episodesByMediaId = {
      909: [ep(1, "downloaded"), ep(1, "downloading")],
    };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("approved");
    state.episodesByMediaId = { 909: [ep(1, "downloaded"), ep(1, "skipped")] };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("approved");
  });

  it("ignores specials, unmonitored episodes and episodes without an air date", async () => {
    state.requests = showRequest();
    state.mediaStatusById = { 909: "wanted" };
    state.episodesByMediaId = {
      909: [
        ep(1, "downloaded"),
        ep(0, "wanted"),
        ep(1, "wanted", PAST, false),
        ep(1, "wanted", null),
      ],
    };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("available");
  });

  it("needs at least one aired episode", async () => {
    state.requests = showRequest();
    state.mediaStatusById = { 909: "downloaded" };
    state.episodesByMediaId = {
      909: [ep(1, "wanted", FUTURE), ep(0, "downloaded")],
    };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("approved");
    state.episodesByMediaId = { 909: [] };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("approved");
  });

  it("notifies once: an already available request is not flipped or notified again", async () => {
    state.requests = showRequest();
    state.mediaStatusById = { 909: "downloaded" };
    state.episodesByMediaId = { 909: [ep(1, "downloaded")] };
    await notifyRequestAvailable(909);
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("available");
    expect(state.notifications).toHaveLength(1);
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
