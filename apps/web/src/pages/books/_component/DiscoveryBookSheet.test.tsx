import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test-utils/render";
import type { BookDiscoveryBook } from "@rawkoon/shared/types";

const mutate = vi.fn();
const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "u", is_admin: auth.isAdmin } }),
}));

const requestMutate = vi.fn();
vi.mock("@/pages/requests/_hooks/useRequests", () => ({
  useCreateRequest: () => ({
    mutate: requestMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
  }),
}));

vi.mock("../_hooks/useBookDiscovery", () => ({
  useAddDiscoveryBook: () => ({ mutate, isPending: false, isSuccess: false }),
}));

import { DiscoveryBookSheet } from "./DiscoveryBookSheet";

const base: BookDiscoveryBook = {
  rank: 1,
  title: "Livre A",
  isbn13: "9780000000001",
  coverUrl: null,
  sourceUrl: "https://www.leslibraires.ca/livres/x-9780000000001",
  author: "Auteur",
  overview: null,
  publishedYear: 2026,
  volumeId: "vol-1",
  alreadyInLibrary: false,
  request: null,
};

describe("DiscoveryBookSheet", () => {
  beforeEach(() => {
    auth.isAdmin = true;
    requestMutate.mockClear();
  });

  it("gives a member a Request action instead of Add", () => {
    auth.isAdmin = false;
    renderWithProviders(<DiscoveryBookSheet book={base} onClose={vi.fn()} />);
    expect(screen.queryByText("books.explore.add")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("books.request.action"));
    expect(requestMutate).toHaveBeenCalledWith({
      type: "book",
      google_volume_id: "vol-1",
      title: "Livre A",
      author: "Auteur",
      poster_url: null,
      year: 2026,
    });
  });

  it("shows the request status for a member, and lets a denied one be re-requested", () => {
    auth.isAdmin = false;
    const { unmount } = renderWithProviders(
      <DiscoveryBookSheet
        book={{ ...base, request: { id: 3, status: "pending" } }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("books.request.status.pending"),
    ).toBeInTheDocument();
    expect(screen.queryByText("books.request.action")).not.toBeInTheDocument();
    unmount();
    renderWithProviders(
      <DiscoveryBookSheet
        book={{ ...base, request: { id: 3, status: "denied" } }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("books.request.again")).toBeInTheDocument();
  });

  it("offers a member nothing when the book has no Google volume", () => {
    auth.isAdmin = false;
    renderWithProviders(
      <DiscoveryBookSheet
        book={{ ...base, volumeId: null }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("books.request.action")).not.toBeInTheDocument();
    expect(screen.queryByText("books.explore.add")).not.toBeInTheDocument();
  });

  it("adds the whole book (server picks volume vs metadata)", () => {
    mutate.mockClear();
    renderWithProviders(<DiscoveryBookSheet book={base} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("books.explore.add"));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ isbn13: "9780000000001", volumeId: "vol-1" }),
    );
  });

  it("still offers Add with an ISBN but no Google volume", () => {
    mutate.mockClear();
    renderWithProviders(
      <DiscoveryBookSheet
        book={{ ...base, volumeId: null }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("books.explore.add"));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ isbn13: "9780000000001", volumeId: null }),
    );
  });

  it("hides Add when there is no ISBN", () => {
    renderWithProviders(
      <DiscoveryBookSheet
        book={{ ...base, isbn13: null, volumeId: null }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("books.explore.add")).not.toBeInTheDocument();
    expect(screen.getByText("leslibraires.ca")).toBeInTheDocument();
  });
});
