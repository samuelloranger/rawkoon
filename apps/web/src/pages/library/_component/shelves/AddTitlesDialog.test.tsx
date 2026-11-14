import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { AddTitlesDialog } from "./AddTitlesDialog";

const item = (id: number, type: "movie" | "show", title: string) => ({
  id,
  tmdb_id: id * 10,
  type,
  title,
  year: 2000 + id,
  poster_url: null,
});

vi.mock("@/features/medias/hooks/useInfiniteLibrary", () => ({
  useInfiniteLibrary: () => ({
    data: {
      pages: [
        {
          items: [
            item(1, "movie", "Alpha"),
            item(2, "movie", "Bravo"),
            item(3, "show", "Charlie"),
          ],
        },
      ],
    },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));

describe("AddTitlesDialog", () => {
  it("lists the library, locks titles already on the shelf, and adds the ticked ones on OK", async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: { body?: unknown }) => ({}),
    );
    const onClose = vi.fn();
    renderWithProviders(
      <AddTitlesDialog
        shelfId={7}
        onShelf={[{ tmdb_id: 20, type: "movie" }]}
        isOpen
        onClose={onClose}
      />,
      { fetcher },
    );

    expect(screen.getByLabelText("Bravo")).toBeDisabled();
    expect(screen.getByLabelText("Bravo")).toBeChecked();

    const ok = screen.getByRole("button", { name: /^shelves\.addSelected/ });
    expect(ok).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Charlie"));
    fireEvent.click(screen.getByLabelText("Alpha"));
    fireEvent.click(ok);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const posted = fetcher.mock.calls
      .filter(([url]) => String(url).includes("/api/shelves/7/entries"))
      .map(([, init]) => init?.body);
    expect(posted).toEqual([
      { tmdb_id: 30, type: "show" },
      { tmdb_id: 10, type: "movie" },
    ]);
  });
});
