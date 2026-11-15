import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "@/test-utils/render";
import { AddFlowProvider, useAddFlow } from "../useAddFlow";

const flags = vi.hoisted(() => ({
  ask_before_adding: true,
  requesters_choose_seasons: true,
  books_enabled: true,
}));
vi.mock("@/lib/routing/useFeatures", () => ({
  featuresQuery: {
    queryKey: ["system", "features"],
    queryFn: async () => ({ ...flags }),
  },
}));
vi.mock("@/features/medias/hooks/useLiveSearchToast", () => ({
  useLiveSearchToast: () => ({ announceAdd: vi.fn() }),
}));
const books = vi.hoisted(() => ({
  profiles: [] as { id: number; name: string; kind: string }[],
  addBook: vi.fn().mockResolvedValue({}),
  defaultId: null as number | null,
}));
vi.mock("@/pages/books/_hooks/useBooks", () => ({
  useAddBook: () => ({ mutateAsync: books.addBook }),
  useBookQualityProfiles: () => ({ data: { profiles: books.profiles } }),
}));
vi.mock("@/pages/books/_hooks/useBookDiscovery", () => ({
  useAddDiscoveryBook: () => ({ mutateAsync: vi.fn() }),
}));

const profile = (id: number, name: string) => ({ id, name });
const state = {
  profiles: [profile(1, "1080p"), profile(2, "2160p")],
};
const seasons = [
  {
    season_number: 0,
    name: "Specials",
    episode_count: 2,
    air_date: "2020-01-01",
  },
  { season_number: 1, name: "S1", episode_count: 6, air_date: "2022-01-01" },
  { season_number: 2, name: "S2", episode_count: 4, air_date: "2023-01-01" },
  { season_number: 3, name: "S3", episode_count: null, air_date: "2999-01-01" },
];

const seasonsFail = vi.hoisted(() => ({ on: false }));
function makeFetcher() {
  return vi.fn((url: string, _options?: unknown) => {
    if (url.includes("post-processing/settings"))
      return Promise.resolve({
        settings: {
          default_movie_quality_profile_id: 2,
          default_show_quality_profile_id: 1,
          default_book_quality_profile_id: books.defaultId,
          search_on_add: true,
          default_season_mode: "all",
          default_monitor_new_seasons: true,
        },
      });
    if (url.includes("quality-profiles"))
      return Promise.resolve({ profiles: state.profiles });
    if (url.includes("modal-data") || url.includes("/medias/")) {
      if (seasonsFail.on) return Promise.reject(new Error("tmdb down"));
      return Promise.resolve({ details: { seasons } });
    }
    return Promise.resolve({ item: { id: 77 }, id: 5 });
  });
}

const show = {
  tmdb_id: 11,
  media_type: "tv" as const,
  title: "A Show",
  can_add: true,
  poster_url: null,
  release_year: 2022,
};
const movie = {
  ...show,
  tmdb_id: 12,
  media_type: "movie" as const,
  title: "A Film",
};

function Trigger() {
  const flow = useAddFlow();
  return (
    <>
      <button onClick={() => void flow.add(show)}>add-show</button>
      <button onClick={() => void flow.add(movie)}>add-movie</button>
      <button onClick={() => void flow.add(show, { compact: true })}>
        add-compact
      </button>
      <button
        onClick={() =>
          void flow.request({
            tmdb_id: 11,
            type: "show",
            title: "A Show",
            poster_url: null,
            year: 2022,
          })
        }
      >
        request-show
      </button>
      <button
        onClick={() =>
          void flow.request({
            tmdb_id: 12,
            type: "movie",
            title: "A Film",
            poster_url: null,
            year: 2022,
          })
        }
      >
        request-movie
      </button>
      <button
        onClick={() =>
          void flow.addBook(
            { kind: "search", google_volume_id: "v1", isbn13: null },
            { title: "A Book", author: "Au", coverUrl: null, year: 2020 },
          )
        }
      >
        add-book
      </button>
    </>
  );
}

const mount = () => {
  const fetcher = makeFetcher();
  renderWithProviders(
    <AddFlowProvider>
      <Trigger />
    </AddFlowProvider>,
    { fetcher },
  );
  return fetcher;
};
const posted = (fetcher: ReturnType<typeof makeFetcher>, url: string) =>
  fetcher.mock.calls.find(
    ([u, o]) => u === url && (o as { method?: string })?.method === "POST",
  )?.[1] as { body: Record<string, unknown> } | undefined;

beforeEach(() => {
  flags.ask_before_adding = true;
  flags.requesters_choose_seasons = true;
  state.profiles = [profile(1, "1080p"), profile(2, "2160p")];
  books.profiles = [];
  books.addBook.mockClear();
  seasonsFail.on = false;
  books.defaultId = null;
});

describe("add dialog", () => {
  it("opens for a show with the strip and posts the chosen seasons", async () => {
    const fetcher = mount();
    fireEvent.click(screen.getByText("add-show"));
    expect(
      await screen.findByText("addDialog.title title:A Show"),
    ).toBeInTheDocument();
    // Specials never show: one bar group per regular season.
    const strip = await screen.findByTestId("season-strip");
    expect(
      strip.querySelectorAll("[aria-label^='addDialog.seasonLabel']"),
    ).toHaveLength(3);
    fireEvent.click(
      screen.getByRole("button", { name: "addDialog.modes.pick" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "addDialog.seasonLabel n:1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "addDialog.add" }));
    await waitFor(() => expect(posted(fetcher, "/api/library")).toBeDefined());
    expect(posted(fetcher, "/api/library")?.body).toEqual({
      tmdb_id: 11,
      type: "show",
      quality_profile_id: 1,
      season_mode: "pick",
      seasons: [1, 2],
      monitor_new_seasons: true,
      search_on_add: true,
    });
  });

  it("pick mode makes seasons toggle buttons", async () => {
    mount();
    fireEvent.click(screen.getByText("add-show"));
    await screen.findByTestId("season-strip");
    fireEvent.click(
      screen.getByRole("button", { name: "addDialog.modes.pick" }),
    );
    const s1 = screen.getByRole("button", {
      name: "addDialog.seasonLabel n:1",
    });
    expect(s1).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(s1);
    expect(s1).toHaveAttribute("aria-pressed", "true");
  });

  it("opens for a movie with two profiles, prefilled with the default", async () => {
    const fetcher = mount();
    fireEvent.click(screen.getByText("add-movie"));
    expect(
      await screen.findByText("addDialog.title title:A Film"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("season-strip")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "addDialog.add" }));
    await waitFor(() => expect(posted(fetcher, "/api/library")).toBeDefined());
    expect(posted(fetcher, "/api/library")?.body).toEqual({
      tmdb_id: 12,
      type: "movie",
      quality_profile_id: 2,
      search_on_add: true,
    });
  });

  it("adds a movie straight away when there is a single profile", async () => {
    state.profiles = [profile(1, "1080p")];
    const fetcher = mount();
    fireEvent.click(screen.getByText("add-movie"));
    await waitFor(() => expect(posted(fetcher, "/api/library")).toBeDefined());
    expect(posted(fetcher, "/api/library")?.body).toEqual({
      tmdb_id: 12,
      type: "movie",
    });
    expect(
      screen.queryByText("addDialog.title title:A Film"),
    ).not.toBeInTheDocument();
  });

  it("is skipped entirely when ask before adding is off", async () => {
    flags.ask_before_adding = false;
    const fetcher = mount();
    fireEvent.click(screen.getByText("add-show"));
    await waitFor(() => expect(posted(fetcher, "/api/library")).toBeDefined());
    expect(posted(fetcher, "/api/library")?.body).toEqual({
      tmdb_id: 11,
      type: "show",
    });
    expect(screen.queryByTestId("season-strip")).not.toBeInTheDocument();
  });

  it("offers a tray with the defaults for the compact variant and expands on the seasons chip", async () => {
    mount();
    fireEvent.click(screen.getByText("add-compact"));
    expect(await screen.findByText("addDialog.skip")).toBeInTheDocument();
    expect(screen.queryByTestId("season-strip")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText(/addDialog.chip.all/));
    expect(await screen.findByTestId("season-strip")).toBeInTheDocument();
  });
});

describe("when the seasons can't be loaded", () => {
  it("still adds a show, with no season fields", async () => {
    seasonsFail.on = true;
    const fetcher = mount();
    fireEvent.click(screen.getByText("add-show"));
    expect(
      await screen.findByText("addDialog.seasonsUnavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("season-strip")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "addDialog.add" }));
    await waitFor(() => expect(posted(fetcher, "/api/library")).toBeDefined());
    expect(posted(fetcher, "/api/library")?.body).toEqual({
      tmdb_id: 11,
      type: "show",
      quality_profile_id: 1,
      search_on_add: true,
    });
  });

  it("still lets a requester request every season", async () => {
    seasonsFail.on = true;
    const fetcher = mount();
    fireEvent.click(screen.getByText("request-show"));
    const btn = await screen.findByRole("button", {
      name: "addDialog.requestAll",
    });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(posted(fetcher, "/api/requests")).toBeDefined());
    expect(posted(fetcher, "/api/requests")?.body).not.toHaveProperty(
      "season_mode",
    );
  });
});

describe("double clicks", () => {
  const count = (fetcher: ReturnType<typeof makeFetcher>, url: string) =>
    fetcher.mock.calls.filter(
      ([u, o]) => u === url && (o as { method?: string })?.method === "POST",
    ).length;

  it("two quick adds of one title join a single prompt", async () => {
    const fetcher = mount();
    fireEvent.click(screen.getByText("add-movie"));
    fireEvent.click(screen.getByText("add-movie"));
    await screen.findByText("addDialog.title title:A Film");
    fireEvent.click(screen.getByRole("button", { name: "addDialog.add" }));
    await waitFor(() => expect(posted(fetcher, "/api/library")).toBeDefined());
    expect(count(fetcher, "/api/library")).toBe(1);
  });

  it("two quick one-tap requests send one request", async () => {
    flags.requesters_choose_seasons = false;
    const fetcher = mount();
    fireEvent.click(screen.getByText("request-movie"));
    fireEvent.click(screen.getByText("request-movie"));
    await waitFor(() => expect(posted(fetcher, "/api/requests")).toBeDefined());
    expect(count(fetcher, "/api/requests")).toBe(1);
  });
});

describe("request flow", () => {
  it("opens the season-only sheet for a show, labelled by the choice", async () => {
    const fetcher = mount();
    fireEvent.click(screen.getByText("request-show"));
    const button = await screen.findByRole("button", {
      name: "addDialog.requestAll",
    });
    expect(screen.queryByText("addDialog.quality")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "addDialog.modes.future" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "addDialog.requestFuture" }),
    );
    expect(button).toBeDefined();
    await waitFor(() => expect(posted(fetcher, "/api/requests")).toBeDefined());
    expect(posted(fetcher, "/api/requests")?.body).toMatchObject({
      tmdb_id: 11,
      type: "show",
      season_mode: "future",
    });
  });

  it("is one tap when requesters may not choose seasons", async () => {
    flags.requesters_choose_seasons = false;
    const fetcher = mount();
    fireEvent.click(screen.getByText("request-show"));
    await waitFor(() => expect(posted(fetcher, "/api/requests")).toBeDefined());
    expect(posted(fetcher, "/api/requests")?.body).not.toHaveProperty(
      "season_mode",
    );
    expect(screen.queryByTestId("season-strip")).not.toBeInTheDocument();
  });

  it("requests a movie in one tap", async () => {
    const fetcher = mount();
    fireEvent.click(screen.getByText("request-movie"));
    await waitFor(() => expect(posted(fetcher, "/api/requests")).toBeDefined());
  });
});

describe("book dialog", () => {
  beforeEach(() => {
    books.profiles = [
      { id: 10, name: "Ebook profile", kind: "ebook" },
      { id: 11, name: "Audio profile", kind: "audiobook" },
      { id: 12, name: "Both profile", kind: "both" },
    ];
  });

  it("adds with the chosen format and a profile that fits it", async () => {
    mount();
    fireEvent.click(screen.getByText("add-book"));
    await screen.findByText("A Book");
    fireEvent.click(
      screen.getByRole("button", { name: "addDialog.formats.both" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "addDialog.add" }));
    await waitFor(() => expect(books.addBook).toHaveBeenCalled());
    expect(books.addBook).toHaveBeenCalledWith({
      google_volume_id: "v1",
      isbn13: null,
      kinds: ["ebook", "audiobook"],
      book_quality_profile_id: 12,
    });
  });

  it("defaults to an ebook with the first matching profile", async () => {
    mount();
    fireEvent.click(screen.getByText("add-book"));
    await screen.findByText("A Book");
    fireEvent.click(screen.getByRole("button", { name: "addDialog.add" }));
    await waitFor(() => expect(books.addBook).toHaveBeenCalled());
    expect(books.addBook).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: ["ebook"],
        book_quality_profile_id: 10,
      }),
    );
  });

  it("preselects Both when the default book profile covers both formats", async () => {
    books.defaultId = 12;
    mount();
    fireEvent.click(screen.getByText("add-book"));
    await screen.findByText("A Book");
    expect(
      screen.getByRole("button", { name: "addDialog.formats.both" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "addDialog.add" }));
    await waitFor(() => expect(books.addBook).toHaveBeenCalled());
    expect(books.addBook).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: ["ebook", "audiobook"],
        book_quality_profile_id: 12,
      }),
    );
  });

  it("preselects Ebook when the default book profile is single-format", async () => {
    books.defaultId = 11;
    mount();
    fireEvent.click(screen.getByText("add-book"));
    await screen.findByText("A Book");
    expect(
      screen.getByRole("button", { name: "addDialog.formats.ebook" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("adds instantly with an ebook when ask before adding is off", async () => {
    flags.ask_before_adding = false;
    mount();
    fireEvent.click(screen.getByText("add-book"));
    await waitFor(() => expect(books.addBook).toHaveBeenCalled());
    expect(books.addBook).toHaveBeenCalledWith({
      google_volume_id: "v1",
      isbn13: null,
      kinds: ["ebook"],
    });
  });
});
