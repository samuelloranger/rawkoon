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

mock.module("@rawkoon/api/services/jellyfin/jellyfinUsers", () => ({
  ...realUsers,
  getJellyfinConfig: async () => ({
    website_url: "http://jellyfin.test",
    api_key: "admin-key",
  }),
}));

const { pushMetadataToJellyfin, hasTextChanges } = await import(
  "./jellyfinMetadata"
);

const movie = {
  tmdbId: 42,
  type: "movie",
  title: "The Title",
  originalTitle: null,
  year: 2024,
};

type Call = { method: string; url: URL; body: string | null };
let calls: Call[] = [];
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;

function serve(found: boolean) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    calls.push({
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (url.pathname === "/Items") {
      return Response.json({
        Items: found ? [{ Id: "item-1", ProviderIds: { Tmdb: "42" } }] : [],
      });
    }
    if (url.pathname === "/Items/item-1" && (init?.method ?? "GET") === "GET") {
      return Response.json({
        Id: "item-1",
        Name: "Jellyfin Name",
        Overview: "Jellyfin overview",
        LockedFields: ["Genres", "Overview"],
      });
    }
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch);
}

const saved = () =>
  JSON.parse(
    calls.find((c) => c.method === "POST" && c.url.pathname === "/Items/item-1")
      ?.body ?? "{}",
  );
const refreshed = () =>
  calls.find((c) => c.url.pathname === "/Items/item-1/Refresh");

beforeEach(() => {
  calls = [];
});
afterEach(() => fetchSpy?.mockRestore());

describe("pushMetadataToJellyfin", () => {
  it("writes and locks a new title, and sets the sort name", async () => {
    serve(true);
    expect(
      await pushMetadataToJellyfin(movie, {
        title: "Le Titre",
        sort_title: "Titre, Le",
      }),
    ).toBe("synced");
    const dto = saved();
    expect(dto.Name).toBe("Le Titre");
    expect(dto.ForcedSortName).toBe("Titre, Le");
    // The rest of the item goes back as Jellyfin sent it
    expect(dto.Overview).toBe("Jellyfin overview");
    expect(dto.LockedFields.sort()).toEqual(["Genres", "Name", "Overview"]);
    expect(refreshed()).toBeUndefined();
  });

  it("unlocks a cleared field and refreshes the item without touching its images", async () => {
    serve(true);
    expect(
      await pushMetadataToJellyfin(movie, { overview: null, sort_title: null }),
    ).toBe("synced");
    const dto = saved();
    expect(dto.LockedFields).toEqual(["Genres"]);
    expect(dto.ForcedSortName).toBeNull();
    const refresh = refreshed();
    expect(refresh?.url.searchParams.get("replaceAllMetadata")).toBe("true");
    expect(refresh?.url.searchParams.get("imageRefreshMode")).toBe("None");
    expect(refresh?.url.searchParams.get("replaceAllImages")).toBe("false");
  });

  it("says when Jellyfin doesn't have the title, without writing anything", async () => {
    serve(false);
    expect(await pushMetadataToJellyfin(movie, { title: "Le Titre" })).toBe(
      "not_found",
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("hasTextChanges", () => {
  it("is true for any title, sort title or overview field, cleared ones included", () => {
    expect(hasTextChanges({})).toBe(false);
    expect(hasTextChanges({ overview: null })).toBe(true);
    expect(hasTextChanges({ title: "x" })).toBe(true);
  });
});
