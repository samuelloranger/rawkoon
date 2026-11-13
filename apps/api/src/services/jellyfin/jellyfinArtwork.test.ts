import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

const realUsers = await import("@rawkoon/api/services/jellyfin/jellyfinUsers");

let config: { website_url: string; api_key: string } | null = {
  website_url: "http://jellyfin.test/",
  api_key: "admin-key",
};
mock.module("@rawkoon/api/services/jellyfin/jellyfinUsers", () => ({
  ...realUsers,
  getJellyfinConfig: async () => config,
}));

const { pickJellyfinCandidate, pushArtworkToJellyfin } = await import(
  "./jellyfinArtwork"
);

const movie = {
  tmdbId: 42,
  type: "movie",
  title: "Le Titre",
  originalTitle: "The Title",
  year: 2024,
};

type Call = { method: string; url: URL };
let calls: Call[] = [];
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;

/** Answers Jellyfin requests by path; search hits come from `search(name, year)`. */
function serve(opts: {
  search: (name: string, year: string | null) => unknown[];
  backdrops?: number;
  downloadStatus?: number;
}) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", url });
    if (url.pathname === "/Items") {
      const items = opts.search(
        url.searchParams.get("searchTerm") ?? "",
        url.searchParams.get("Years"),
      );
      return Response.json({ Items: items });
    }
    if (url.pathname.endsWith("/RemoteImages/Download")) {
      return new Response(null, { status: opts.downloadStatus ?? 204 });
    }
    if (url.pathname.endsWith("/Index"))
      return new Response(null, { status: 204 });
    return Response.json({
      BackdropImageTags: Array.from(
        { length: opts.backdrops ?? 1 },
        (_, i) => `t${i}`,
      ),
    });
  }) as unknown as typeof fetch);
}

beforeEach(() => {
  calls = [];
  config = { website_url: "http://jellyfin.test/", api_key: "admin-key" };
});
afterEach(() => fetchSpy?.mockRestore());

describe("pickJellyfinCandidate", () => {
  it("keeps the hit whose TMDB id matches", () => {
    const hits = [
      { id: "a", tmdbId: "7" },
      { id: "b", tmdbId: "42" },
    ];
    expect(pickJellyfinCandidate(hits, 42)?.id).toBe("b");
  });

  it("takes a lone hit with no TMDB id, but not several", () => {
    expect(pickJellyfinCandidate([{ id: "a", tmdbId: null }], 42)?.id).toBe(
      "a",
    );
    expect(
      pickJellyfinCandidate(
        [
          { id: "a", tmdbId: null },
          { id: "b", tmdbId: null },
        ],
        42,
      ),
    ).toBeNull();
    expect(pickJellyfinCandidate([{ id: "a", tmdbId: "7" }], 42)).toBeNull();
  });
});

describe("pushArtworkToJellyfin", () => {
  it("sets the poster on the item with the title's TMDB id", async () => {
    serve({ search: () => [{ Id: "item-1", ProviderIds: { Tmdb: "42" } }] });
    expect(
      await pushArtworkToJellyfin(movie, "poster", "https://img.test/p.jpg"),
    ).toBe("synced");
    const download = calls.find((c) => c.method === "POST");
    expect(download?.url.pathname).toBe("/Items/item-1/RemoteImages/Download");
    expect(download?.url.searchParams.get("type")).toBe("Primary");
    expect(download?.url.searchParams.get("imageUrl")).toBe(
      "https://img.test/p.jpg",
    );
    // A poster replaces the one there: nothing to reorder
    expect(calls.some((c) => c.url.pathname.endsWith("/Index"))).toBe(false);
  });

  it("moves a new backdrop first, where clients read it", async () => {
    serve({
      search: () => [{ Id: "item-1", ProviderIds: { Tmdb: "42" } }],
      backdrops: 3,
    });
    expect(
      await pushArtworkToJellyfin(movie, "backdrop", "https://img.test/b.jpg"),
    ).toBe("synced");
    const move = calls.find((c) => c.url.pathname.endsWith("/Index"));
    expect(move?.url.pathname).toBe("/Items/item-1/Images/Backdrop/2/Index");
    expect(move?.url.searchParams.get("newIndex")).toBe("0");
  });

  it("falls back to the original title and to no year", async () => {
    serve({
      search: (name, year) =>
        name === "The Title" && year === null
          ? [{ Id: "item-9", ProviderIds: { Tmdb: "42" } }]
          : [],
    });
    expect(
      await pushArtworkToJellyfin(movie, "poster", "https://img.test/p.jpg"),
    ).toBe("synced");
    expect(calls.find((c) => c.method === "POST")?.url.pathname).toBe(
      "/Items/item-9/RemoteImages/Download",
    );
  });

  it("reports a title Jellyfin doesn't have, and never throws", async () => {
    serve({ search: () => [{ Id: "other", ProviderIds: { Tmdb: "7" } }] });
    expect(
      await pushArtworkToJellyfin(movie, "poster", "https://img.test/p.jpg"),
    ).toBe("not_found");

    serve({
      search: () => [{ Id: "item-1", ProviderIds: { Tmdb: "42" } }],
      downloadStatus: 500,
    });
    expect(
      await pushArtworkToJellyfin(movie, "poster", "https://img.test/p.jpg"),
    ).toBe("failed");
  });

  it("does nothing when Jellyfin isn't set up", async () => {
    config = null;
    serve({ search: () => [] });
    expect(
      await pushArtworkToJellyfin(movie, "poster", "https://img.test/p.jpg"),
    ).toBe("off");
    expect(calls).toHaveLength(0);
  });
});
