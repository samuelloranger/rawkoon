import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { UpcomingRail } from "@/pages/_component/UpcomingRail";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Stub the heavy add/search dialog — we only assert it opens with the right item.
vi.mock("@/pages/medias/_component/ExploreCardDetailDialog", () => ({
  ExploreCardDetailDialog: ({
    item,
    isOpen,
  }: {
    item: { tmdb_id: number };
    isOpen: boolean;
  }) =>
    isOpen ? <div data-testid="add-dialog">add:{item.tmdb_id}</div> : null,
}));

describe("UpcomingRail", () => {
  it("renders upcoming items", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      enabled: true,
      items: [
        {
          id: "9",
          title: "Dune 3",
          media_type: "movie",
          release_date: "2026-12-01",
          poster_url: "/d3.jpg",
          backdrop_url: null,
          overview: null,
          tmdb_url: null,
          providers: [],
          library_id: null,
          season_number: null,
          episode_number: null,
        },
      ],
    });
    renderWithProviders(<UpcomingRail />, { fetcher });
    await waitFor(() => expect(screen.getByText("Dune 3")).toBeInTheDocument());
  });

  it("opens the add dialog when a non-library upcoming card is clicked", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      enabled: true,
      items: [
        {
          id: "movie-555",
          title: "Dune 3",
          media_type: "movie",
          release_date: "2026-12-01",
          poster_url: "/d3.jpg",
          backdrop_url: null,
          overview: null,
          tmdb_url: null,
          providers: [],
          library_id: null,
          season_number: null,
          episode_number: null,
        },
      ],
    });
    renderWithProviders(<UpcomingRail />, { fetcher });
    const card = await screen.findByRole("button", { name: "Dune 3" });
    fireEvent.click(card);
    expect(await screen.findByTestId("add-dialog")).toHaveTextContent(
      "add:555",
    );
  });

  it("shows the empty state when there are no upcoming items", async () => {
    const fetcher = vi.fn().mockResolvedValue({ enabled: true, items: [] });
    renderWithProviders(<UpcomingRail />, { fetcher });
    // The global test setup mocks i18n so `t(key)` returns the key itself.
    await waitFor(() =>
      expect(
        screen.getByText("dashboard.home.upcomingEmpty"),
      ).toBeInTheDocument(),
    );
  });
});
