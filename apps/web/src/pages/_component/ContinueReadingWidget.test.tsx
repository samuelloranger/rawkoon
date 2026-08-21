import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { ContinueReadingWidget } from "@/pages/_component/ContinueReadingWidget";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

const ebook = {
  edition_id: 5,
  book_id: 42,
  kind: "ebook" as const,
  title: "A Quiet Harbour",
  authors: ["M. Roy"],
  cover_url: null,
  percent: 0.37,
  position_secs: null,
  total_duration_secs: null,
  updated_at: "2026-08-21T10:00:00.000Z",
};

const audiobook = {
  edition_id: 6,
  book_id: 43,
  kind: "audiobook" as const,
  title: "The Long Drive",
  authors: [],
  cover_url: null,
  percent: null,
  position_secs: 3_720,
  total_duration_secs: 36_000,
  updated_at: "2026-08-21T09:00:00.000Z",
};

describe("ContinueReadingWidget", () => {
  it("renders nothing when no book has been started", async () => {
    const fetcher = vi.fn().mockResolvedValue({ reading: [] });
    const { container } = renderWithProviders(<ContinueReadingWidget />, {
      fetcher,
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a started ebook with its percentage", async () => {
    const fetcher = vi.fn().mockResolvedValue({ reading: [ebook] });
    renderWithProviders(<ContinueReadingWidget />, { fetcher });

    await waitFor(() =>
      expect(screen.getByText("A Quiet Harbour")).toBeInTheDocument(),
    );
    expect(screen.getByText("M. Roy")).toBeInTheDocument();
    expect(screen.getByText("37%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "37",
    );
  });

  it("shows an audiobook as a clock, not a percentage", async () => {
    const fetcher = vi.fn().mockResolvedValue({ reading: [audiobook] });
    renderWithProviders(<ContinueReadingWidget />, { fetcher });

    await waitFor(() =>
      expect(screen.getByText("The Long Drive")).toBeInTheDocument(),
    );
    expect(screen.getByText("1:02:00")).toBeInTheDocument();
    // The bar still moves: position over the known total.
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
  });

  it("opens the reader for an ebook and the player for an audiobook", async () => {
    const fetcher = vi.fn().mockResolvedValue({ reading: [ebook, audiobook] });
    renderWithProviders(<ContinueReadingWidget />, { fetcher });
    await waitFor(() =>
      expect(screen.getByText("A Quiet Harbour")).toBeInTheDocument(),
    );

    navigate.mockClear();
    screen.getByText("A Quiet Harbour").click();
    expect(navigate).toHaveBeenCalledWith({
      to: "/books/$bookId/read",
      params: { bookId: "42" },
    });

    navigate.mockClear();
    screen.getByText("The Long Drive").click();
    expect(navigate).toHaveBeenCalledWith({
      to: "/books/$bookId/listen",
      params: { bookId: "43" },
    });
  });

  it("leaves the bar empty for an audiobook of unknown length", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      reading: [{ ...audiobook, total_duration_secs: null }],
    });
    renderWithProviders(<ContinueReadingWidget />, { fetcher });

    await waitFor(() =>
      expect(screen.getByText("The Long Drive")).toBeInTheDocument(),
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});
