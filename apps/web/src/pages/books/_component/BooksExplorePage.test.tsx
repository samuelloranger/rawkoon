import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "@/test-utils/render";
import { BooksExplorePage } from "./BooksExplorePage";

vi.mock("@/pages/books/_hooks/useBookDiscovery", () => ({
  useBookDiscoverySources: () => ({
    data: {
      sources: [
        {
          id: "leslibraires",
          label: "Palmarès Québec",
          lists: [{ id: "general", label: "Palmarès" }],
        },
      ],
    },
    isLoading: false,
  }),
  useBookDiscovery: () => ({
    data: {
      source: "leslibraires",
      list: "general",
      items: [
        {
          rank: 1,
          title: "Livre A",
          isbn13: "9780000000001",
          coverUrl: null,
          sourceUrl: null,
          author: "Auteur",
          overview: null,
          publishedYear: 2026,
          volumeId: "v1",
          alreadyInLibrary: true,
        },
      ],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

describe("BooksExplorePage", () => {
  it("renders ranked cards and the in-library badge", () => {
    renderWithProviders(<BooksExplorePage />);
    expect(screen.getByText("Livre A")).toBeInTheDocument();
    expect(screen.getByText("Auteur")).toBeInTheDocument();
    // t() returns the key in tests.
    expect(screen.getByText("books.explore.inLibrary")).toBeInTheDocument();
  });
});
