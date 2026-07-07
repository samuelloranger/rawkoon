import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LibraryStats } from "@rawkoon/shared/types";
import { LibraryStatsPanel } from "./LibraryStatsPanel";

// Mock react-i18next — return the key so we can assert against label keys.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// Mock the data hook so we control loading / error / data states.
const mockUseLibraryStats = vi.fn();
vi.mock("@/features/medias/hooks/useLibraryStats", () => ({
  useLibraryStats: () => mockUseLibraryStats(),
}));

function makeStats(overrides: Partial<LibraryStats> = {}): LibraryStats {
  return {
    total_movies: 12,
    total_shows: 5,
    downloaded: 9,
    wanted: 3,
    returning_series: 2,
    storage_used_bytes: 1024 * 1024 * 1024 * 250, // 250 GB
    counts_by_status_type: [],
    storage_by_resolution: [
      { resolution: "1080p", size_bytes: 1024 * 1024 * 1024 * 200 },
      { resolution: "4k", size_bytes: 1024 * 1024 * 1024 * 50 },
      { resolution: "720p", size_bytes: 0 },
    ],
    shows_by_tmdb_status: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LibraryStatsPanel", () => {
  it("renders all stat tiles with values from the stats payload", () => {
    mockUseLibraryStats.mockReturnValue({
      data: makeStats(),
      isLoading: false,
      isError: false,
    });

    render(<LibraryStatsPanel />);

    expect(screen.getByText("library.stats.movies")).toBeInTheDocument();
    expect(screen.getByText("library.stats.shows")).toBeInTheDocument();
    expect(screen.getByText("library.stats.downloaded")).toBeInTheDocument();
    expect(screen.getByText("library.stats.wanted")).toBeInTheDocument();
    expect(
      screen.getByText("library.stats.returningSeries"),
    ).toBeInTheDocument();
    expect(screen.getByText("library.stats.totalStorage")).toBeInTheDocument();

    // Values render (tabular numbers, localized)
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the resolution breakdown only for rows with size_bytes > 0", () => {
    mockUseLibraryStats.mockReturnValue({
      data: makeStats(),
      isLoading: false,
      isError: false,
    });

    render(<LibraryStatsPanel />);

    expect(
      screen.getByText("library.stats.storageByResolution"),
    ).toBeInTheDocument();
    expect(screen.getByText("1080p")).toBeInTheDocument();
    expect(screen.getByText("4K")).toBeInTheDocument();
    // 720p has size_bytes 0 → filtered out
    expect(screen.queryByText("720p")).not.toBeInTheDocument();
  });

  it("renders a quiet error state when the query errors", () => {
    mockUseLibraryStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<LibraryStatsPanel />);

    expect(screen.getByText("library.stats.error")).toBeInTheDocument();
  });

  it("does not render tiles while loading", () => {
    mockUseLibraryStats.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<LibraryStatsPanel />);

    expect(screen.queryByText("library.stats.movies")).not.toBeInTheDocument();
  });
});
