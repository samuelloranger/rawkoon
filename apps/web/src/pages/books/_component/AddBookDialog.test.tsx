import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test-utils/render";

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "u", is_admin: auth.isAdmin } }),
}));

const addMutate = vi.fn();
const requestMutate = vi.fn();
vi.mock("../_hooks/useBooks", () => ({
  useAddBook: () => ({ mutate: addMutate, isPending: false }),
  useBookProviderSearch: () => ({
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
  }),
}));
vi.mock("@/pages/requests/_hooks/useRequests", () => ({
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
    addMutate.mockClear();
    requestMutate.mockClear();
  });

  it("lets an admin add straight to the library", () => {
    renderWithProviders(<AddBookDialog onClose={vi.fn()} />);
    expect(screen.getByText("books.add.addAs")).toBeInTheDocument();
    expect(screen.queryByText("books.request.action")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("books.add.addAction"));
    expect(addMutate).toHaveBeenCalled();
    expect(requestMutate).not.toHaveBeenCalled();
  });

  it("makes a member request the book instead", () => {
    auth.isAdmin = false;
    renderWithProviders(<AddBookDialog onClose={vi.fn()} />);
    expect(screen.queryByText("books.add.addAction")).not.toBeInTheDocument();
    expect(screen.queryByText("books.add.addAs")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("books.request.action"));
    expect(requestMutate).toHaveBeenCalledWith({
      type: "book",
      google_volume_id: "vol-1",
      title: "Livre A",
      author: "Auteur",
      poster_url: null,
      year: 2026,
    });
    expect(addMutate).not.toHaveBeenCalled();
  });
});
