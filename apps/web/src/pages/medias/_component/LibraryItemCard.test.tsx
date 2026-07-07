import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LibraryItemCard } from "./LibraryItemCard";
import type { LibraryMedia } from "@rawkoon/shared/types";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
    i18n: { language: "en" },
  }),
}));

// Mock TanStack Router
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

// Mock prefetch hook
const mockPrefetch = vi.fn();
vi.mock("@/features/medias/hooks/usePrefetchLibraryItem", () => ({
  usePrefetchLibraryItem: () => mockPrefetch,
}));

// Mock libraryStatusPresentation (use real impl - import normally)
// No need to mock - we'll use the real implementation

function makeItem(overrides: Partial<LibraryMedia> = {}): LibraryMedia {
  return {
    id: 42,
    tmdb_id: 100,
    type: "movie",
    title: "Test Movie",
    sort_title: "Test Movie",
    year: 2024,
    status: "wanted",
    monitored: true,
    poster_url: null,
    overview: null,
    digital_release_date: null,
    quality_profile_id: null,
    search_attempts: 0,
    quality_profile: null,
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    last_grabbed_at: null,
    total_size_bytes: null,
    resolution: null,
    video_codec: null,
    hdr_format: null,
    audio_format: null,
    duration_secs: null,
    language_tags: [],
    episode_count: null,
    downloaded_episode_count: null,
    season_count: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LibraryItemCard", () => {
  describe("wanted item with onMovieSearch", () => {
    it("renders a search button that calls onMovieSearch with item.id and does not navigate", () => {
      const onMovieSearch = vi.fn();
      const item = makeItem({ status: "wanted" });

      render(<LibraryItemCard item={item} onMovieSearch={onMovieSearch} />);

      // The search button should be present (opacity-0 but in DOM)
      const searchBtn = screen.getByRole("button", {
        name: /library\.management\.searchNow/i,
      });
      expect(searchBtn).toBeInTheDocument();

      fireEvent.click(searchBtn);

      expect(onMovieSearch).toHaveBeenCalledWith(item.id);
      expect(onMovieSearch).toHaveBeenCalledTimes(1);
      // navigate should NOT have been called
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("shows the corner badge chip for wanted status", () => {
      const item = makeItem({ status: "wanted" });
      render(<LibraryItemCard item={item} />);

      // wanted has showBadge: true — a rounded-md chip div exists in the top-right area
      // Query by the badge class pattern: it contains "rounded-md" and the label key text
      const badges = screen.getAllByTitle("medias.library.itemStatus.wanted");
      // The corner badge chip (div) should be one of them (not the liseré)
      const chipBadge = badges.find(
        (el) => el.tagName === "DIV" && el.classList.contains("rounded-md"),
      );
      expect(chipBadge).toBeTruthy();
    });
  });

  describe("downloaded item", () => {
    it("does not render a corner badge chip", () => {
      const item = makeItem({ status: "downloaded" });
      render(<LibraryItemCard item={item} />);

      // downloaded has showBadge: false — no rounded-md chip div with this title
      const allWithTitle = screen.queryAllByTitle(
        "medias.library.itemStatus.downloaded",
      );
      const chipBadge = allWithTitle.find(
        (el) => el.tagName === "DIV" && el.classList.contains("rounded-md"),
      );
      expect(chipBadge).toBeUndefined();
    });

    it("does not render a search button", () => {
      const onMovieSearch = vi.fn();
      const item = makeItem({ status: "downloaded" });
      render(<LibraryItemCard item={item} onMovieSearch={onMovieSearch} />);

      // No search button for downloaded status
      const btns = screen.queryAllByRole("button", {
        name: /searchNow/i,
      });
      expect(btns).toHaveLength(0);
    });
  });

  describe("disabled state", () => {
    it("disables the search button when movieSearchPending is true", () => {
      const onMovieSearch = vi.fn();
      const item = makeItem({ status: "wanted" });

      render(
        <LibraryItemCard
          item={item}
          onMovieSearch={onMovieSearch}
          movieSearchPending={true}
        />,
      );

      const searchBtn = screen.getByRole("button", {
        name: /library\.management\.searchNow/i,
      });
      expect(searchBtn).toBeDisabled();
    });
  });
});
