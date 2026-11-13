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
  backdropsAt?: () => number;
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
        { length: opts.backdropsAt?.() ?? 1 },
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
  const title = { tmdbId: 42, names: ["Dune"], year: 2021 };
  const hit = (
    id: string,
    tmdbId: string | null,
    name = "Dune",
    year: number | null = 2021,
  ) => ({
    id,
    tmdbId,
    name,
    year,
  });

  it("keeps the hit whose TMDB id matches", () => {
    expect(
      pickJellyfinCandidate([hit("a", "7"), hit("b", "42")], title)?.id,
    ).toBe("b");
  });

  it("takes a lone unverified hit only when its name and year are the title's", () => {
    expect(pickJellyfinCandidate([hit("a", null, "dune")], title)?.id).toBe(
      "a",
    );
    // The search is fuzzy: a longer name is another title
    expect(
      pickJellyfinCandidate([hit("a", null, "Dune: Part Two")], title),
    ).toBeNull();
    expect(
      pickJellyfinCandidate([hit("a", null, "Dune", 1984)], title),
    ).toBeNull();
    expect(
      pickJellyfinCandidate([hit("a", null), hit("b", null)], title),
    ).toBeNull();
    expect(pickJellyfinCandidate([hit("a", "7")], title)).toBeNull();
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
    let reads = 0;
    serve({
      backdropsAt: () => (reads++ === 0 ? 2 : 3),
      search: () => [{ Id: "item-1", ProviderIds: { Tmdb: "42" } }],
    });
    expect(
      await pushArtworkToJellyfin(movie, "backdrop", "https://img.test/b.jpg"),
    ).toBe("synced");
    const move = calls.find((c) => c.url.pathname.endsWith("/Index"));
    expect(move?.url.pathname).toBe("/Items/item-1/Images/Backdrop/2/Index");
    expect(move?.url.searchParams.get("newIndex")).toBe("0");
  });

  it("leaves the backdrops alone when the download added none", async () => {
    serve({
      backdropsAt: () => 3,
      search: () => [{ Id: "item-1", ProviderIds: { Tmdb: "42" } }],
    });
    expect(
      await pushArtworkToJellyfin(movie, "backdrop", "https://img.test/b.jpg"),
    ).toBe("synced");
    expect(calls.some((c) => c.url.pathname.endsWith("/Index"))).toBe(false);
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

  it("finds an item Jellyfin names differently by its TMDB id around the year", async () => {
    serve({
      search: (name, year) =>
        name === "" && year === "2023,2024,2025"
          ? [
              { Id: "other", ProviderIds: { Tmdb: "7" } },
              { Id: "item-5", ProviderIds: { Tmdb: "42" } },
            ]
          : [],
    });
    expect(
      await pushArtworkToJellyfin(movie, "poster", "https://img.test/p.jpg"),
    ).toBe("synced");
    expect(calls.find((c) => c.method === "POST")?.url.pathname).toBe(
      "/Items/item-5/RemoteImages/Download",
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
