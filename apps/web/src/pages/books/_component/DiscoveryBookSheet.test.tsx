import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test-utils/render";
import type { BookDiscoveryBook } from "@rawkoon/shared/types";

const mutate = vi.fn();
vi.mock("../_hooks/useBooks", () => ({
  useAddBook: () => ({ mutate, isPending: false, isSuccess: false }),
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
};

describe("DiscoveryBookSheet", () => {
  it("adds by volumeId when enriched", () => {
    mutate.mockClear();
    renderWithProviders(<DiscoveryBookSheet book={base} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("books.explore.add"));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        google_volume_id: "vol-1",
        isbn13: "9780000000001",
      }),
    );
  });

  it("hides Add and shows the external link when not enriched", () => {
    renderWithProviders(
      <DiscoveryBookSheet
        book={{ ...base, volumeId: null }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("books.explore.add")).not.toBeInTheDocument();
    expect(screen.getByText("leslibraires.ca")).toBeInTheDocument();
  });
});
