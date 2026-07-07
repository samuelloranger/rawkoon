import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { NowWatchingWidget } from "@/pages/_component/NowWatchingWidget";

describe("NowWatchingWidget", () => {
  it("renders nothing when Jellyfin disabled", async () => {
    const fetcher = vi.fn().mockResolvedValue({ enabled: false, sessions: [] });
    const { container } = renderWithProviders(<NowWatchingWidget />, {
      fetcher,
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
  it("shows the quiet placeholder when enabled with no sessions", async () => {
    const fetcher = vi.fn().mockResolvedValue({ enabled: true, sessions: [] });
    renderWithProviders(<NowWatchingWidget />, { fetcher });
    await waitFor(() =>
      expect(
        screen.getByText("dashboard.home.nowWatchingEmpty"),
      ).toBeInTheDocument(),
    );
  });
  it("renders a session row with title and user", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      enabled: true,
      sessions: [
        {
          session_id: "s1",
          user: "sam",
          device: "TV",
          title: "Dune",
          poster_url: "/p.jpg",
          progress_pct: 50,
          paused: false,
        },
      ],
    });
    renderWithProviders(<NowWatchingWidget />, { fetcher });
    await waitFor(() => expect(screen.getByText("Dune")).toBeInTheDocument());
    expect(screen.getByText(/sam/)).toBeInTheDocument();
  });
});
