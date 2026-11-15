import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindResults } from "../FindResults";

let booksEnabled = true;
const bookSearch = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "en" },
  }),
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { is_admin: false } }),
}));
vi.mock("@/lib/routing/useFeatures", () => ({
  useFeatures: () => ({ data: { books_enabled: booksEnabled } }),
}));
vi.mock("@/lib/search/useSearch", () => ({
  useQuickSearch: () => ({
    isLoading: false,
    data: {
      medias: [
        {
          id: 1,
          title: "Owned Show",
          type: "show",
          year: 2020,
          status: "downloaded",
        },
      ],
      books: [],
      users: [],
    },
  }),
}));
vi.mock("@/features/medias/hooks/useTmdbMediaSearch", () => ({
  useTmdbMediaSearch: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: { enabled: true, items: [{ id: "tv-1", title: "Tmdb Title" }] },
  }),
}));
vi.mock("@/pages/medias/_component/TmdbResultCard", () => ({
  TmdbResultCard: ({ item }: { item: { title: string } }) => (
    <div>{item.title}</div>
  ),
}));
vi.mock("@/pages/medias/_component/ExploreCardDetailDialog", () => ({
  ExploreCardDetailDialog: () => null,
}));
vi.mock("@/pages/books/_hooks/useBooks", () => ({
  useBookProviderSearch: (term: string, enabled: boolean) => {
    bookSearch(term, enabled);
    return {
      isLoading: false,
      isError: false,
      data: {
        results: [
          {
            google_volume_id: "v1",
            title: "Some Book",
            authors: ["A"],
            published_year: 2001,
            cover_url: null,
            in_library: false,
            library_book_id: null,
            request: null,
          },
        ],
      },
    };
  },
}));
vi.mock("@/pages/books/_component/BookRequestAction", () => ({
  BookRequestAction: () => <span>request</span>,
}));
vi.mock("@/features/add/useAddFlow", () => ({
  useAddFlow: () => ({ addBook: vi.fn().mockResolvedValue(false) }),
}));

describe("FindResults", () => {
  it("shows library, titles, then books", () => {
    booksEnabled = true;
    render(<FindResults query="sev" />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual([
      "find.groups.library",
      "find.groups.titles",
      "find.groups.books",
    ]);
    expect(
      screen.getByText("Owned Show").closest("a")?.getAttribute("href"),
    ).toBe("/library/$libraryId");
    expect(screen.getByText("Tmdb Title")).toBeTruthy();
    expect(screen.getByText("Some Book")).toBeTruthy();
  });

  it("drops the books group when books are off", () => {
    booksEnabled = false;
    render(<FindResults query="sev" />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["find.groups.library", "find.groups.titles"]);
  });
});
