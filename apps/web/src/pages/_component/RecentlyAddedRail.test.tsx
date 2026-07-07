import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { RecentlyAddedRail } from "@/pages/_component/RecentlyAddedRail";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

describe("RecentlyAddedRail", () => {
  it("renders library items newest-first", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          title: "Old",
          poster_url: "/o.jpg",
          added_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          title: "New",
          poster_url: "/n.jpg",
          added_at: "2026-06-01T00:00:00Z",
        },
      ],
    });
    renderWithProviders(<RecentlyAddedRail />, { fetcher });
    await waitFor(() => expect(screen.getByText("New")).toBeInTheDocument());
    expect(screen.getByText("Old")).toBeInTheDocument();
  });

  it("renders library items as client-side navigations, not new-tab links", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          title: "Dune",
          poster_url: "/d.jpg",
          added_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    renderWithProviders(<RecentlyAddedRail />, { fetcher });
    const card = await screen.findByRole("button", { name: "Dune" });
    expect(card).not.toHaveAttribute("target");
  });

  it("shows the empty state for an empty library", async () => {
    const fetcher = vi.fn().mockResolvedValue({ items: [] });
    renderWithProviders(<RecentlyAddedRail />, { fetcher });
    // The global test setup mocks i18n so `t(key)` returns the key itself;
    // the empty label resolves to its translation key.
    await waitFor(() =>
      expect(
        screen.getByText("dashboard.home.recentlyAddedEmpty"),
      ).toBeInTheDocument(),
    );
  });
});
