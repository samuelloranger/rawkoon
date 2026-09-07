import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { ListeningStatsWidget } from "./ListeningStatsWidget";

const mockUseFeatures = vi.fn();
const mockUseListeningStats = vi.fn();

vi.mock("@/lib/routing/useFeatures", () => ({
  useFeatures: () => mockUseFeatures(),
}));
vi.mock("./useListeningStats", () => ({
  useListeningStats: () => mockUseListeningStats(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

const statsFixture = {
  timezone: "America/Toronto",
  today_secs: 0,
  week_secs: 12000,
  streak_days: 3,
  since: "2026-09-01",
  week: [],
  series: [
    {
      name: "Discworld",
      books_total: 4,
      books_finished: 1,
      percent: 50,
      current_title: "Guards! Guards!",
    },
  ],
};

describe("ListeningStatsWidget", () => {
  beforeEach(() => {
    mockUseFeatures.mockReturnValue({
      data: { books_enabled: true },
    });
    mockUseListeningStats.mockReturnValue({
      data: statsFixture,
      isLoading: false,
      isError: false,
    });
  });

  it("shows title, week hours, and series line when books enabled", () => {
    renderWithProviders(<ListeningStatsWidget />);
    expect(screen.getByText("listening.title")).toBeInTheDocument();
    expect(screen.getByText("3h 20m")).toBeInTheDocument();
    expect(
      screen.getByText(/listening\.seriesLine.*Discworld.*percent:50/),
    ).toBeInTheDocument();
  });

  it("renders nothing when books disabled", () => {
    mockUseFeatures.mockReturnValue({
      data: { books_enabled: false },
    });
    const { container } = renderWithProviders(<ListeningStatsWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
