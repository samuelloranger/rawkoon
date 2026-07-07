/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, renderWithProviders } from "@/test-utils/render";
import { Calendar } from "@/pages/calendar/_component/Calendar";

// Mock TanStack Router
vi.mock("@tanstack/react-router", () => ({
  useSearch: vi.fn().mockReturnValue({}),
  useNavigate: vi.fn().mockReturnValue(vi.fn()),
  useParams: vi.fn().mockReturnValue({}),
}));

vi.mock("@/pages/_component/useDashboardUpcoming", () => ({
  useDashboardUpcoming: vi.fn(),
}));

import { useDashboardUpcoming } from "@/pages/_component/useDashboardUpcoming";

describe("Calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the release calendar", async () => {
    (useDashboardUpcoming as any).mockReturnValue({
      data: { items: [], enabled: true },
      isLoading: false,
    });

    renderWithProviders(<Calendar />);

    await waitFor(() => {
      expect(screen.getAllByText("calendar.title").length).toBeGreaterThan(0);
    });
  });

  it("shows release posters when releases are present", async () => {
    const today = new Date().toISOString().slice(0, 10);
    (useDashboardUpcoming as any).mockReturnValue({
      data: {
        enabled: true,
        items: [
          {
            id: "movie-1",
            title: "Test Release",
            media_type: "movie",
            release_date: today,
            poster_url: "https://example.com/p.jpg",
            backdrop_url: null,
            overview: null,
            tmdb_url: null,
            providers: [],
            library_id: null,
            season_number: null,
            episode_number: null,
          },
        ],
      },
      isLoading: false,
    });

    renderWithProviders(<Calendar />);

    await waitFor(() => {
      const posters = document.querySelectorAll(
        'img[src="https://example.com/p.jpg"]',
      );
      expect(posters.length).toBeGreaterThan(0);
    });
  });
});
