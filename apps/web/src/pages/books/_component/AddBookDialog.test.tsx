import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test-utils/render";

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "u", is_admin: auth.isAdmin } }),
}));

const providerSearch = vi.hoisted(() => vi.fn());
const addBook = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const requestMutate = vi.fn();
vi.mock("../_hooks/useBooks", () => ({
  useBookProviderSearch: (term: string, enabled: boolean) => {
    providerSearch(term, enabled);
    return {
      data: {
        results: [
          {
            google_volume_id: "vol-1",
            title: "Livre A",
            subtitle: null,
            authors: ["Auteur"],
            language: "fr",
            published_year: 2026,
            isbn13: null,
            cover_url: null,
            overview: null,
            in_library: false,
            library_book_id: null,
            request: null,
          },
        ],
      },
      isFetching: false,
      error: null,
    };
  },
}));
vi.mock("@/features/add/useAddFlow", () => ({
  useAddFlow: () => ({ addBook }),
}));
vi.mock("@/pages/activity/requests/_hooks/useRequests", () => ({
  useCreateRequest: () => ({
    mutate: requestMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
  }),
}));

import { AddBookDialog } from "./AddBookDialog";

describe("AddBookDialog", () => {
  beforeEach(() => {
    auth.isAdmin = true;
    addBook.mockClear();
    requestMutate.mockClear();
  });

  it("lets an admin add straight to the library", () => {
    renderWithProviders(<AddBookDialog onClose={vi.fn()} />);
    expect(screen.queryByText("books.request.action")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("books.add.addAction"));
    expect(addBook).toHaveBeenCalledWith(
      { kind: "search", google_volume_id: "vol-1", isbn13: null },
      expect.objectContaining({ title: "Livre A", author: "Auteur" }),
    );
    expect(requestMutate).not.toHaveBeenCalled();
  });

  it("makes a member request the book instead", () => {
    auth.isAdmin = false;
    renderWithProviders(<AddBookDialog onClose={vi.fn()} />);
    expect(screen.queryByText("books.add.addAction")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("books.request.action"));
    expect(requestMutate).toHaveBeenCalledWith({
      type: "book",
      google_volume_id: "vol-1",
      title: "Livre A",
      author: "Auteur",
      poster_url: null,
      year: 2026,
    });
    expect(addBook).not.toHaveBeenCalled();
  });

  it("starts searching for the initial query as soon as it opens", () => {
    providerSearch.mockClear();
    renderWithProviders(
      <AddBookDialog onClose={vi.fn()} initialQuery="dune" />,
    );
    expect(providerSearch).toHaveBeenCalledWith("dune", true);
  });
});
