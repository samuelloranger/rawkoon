import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DiscoverDeck } from "./DiscoverDeck";

const deck = vi.hoisted(() => ({
  addCurrent: vi.fn(),
  dismissCurrent: vi.fn(),
}));
vi.mock("../_hooks/useDiscoverDeck", () => ({
  useDiscoverDeck: () => ({
    status: "ready",
    source: "trending",
    isAdmin: true,
    current: {
      id: "m1",
      tmdb_id: 1,
      genre_ids: [],
      title: "T",
      poster_url: null,
    },
    upcoming: [],
    canUndo: false,
    undo: vi.fn(),
    watchlistCurrent: vi.fn(),
    reload: vi.fn(),
    ...deck,
  }),
}));
vi.mock("@/features/medias/hooks/useSearchOnAddEnabled", () => ({
  useSearchOnAddEnabled: () => false,
}));
vi.mock("@/features/medias/hooks/useMediaGenres", () => ({
  useMediaGenres: () => ({ data: undefined }),
}));
vi.mock("./DiscoverCard", () => ({ DiscoverCard: () => <div>card</div> }));
vi.mock("./DiscoverActionBar", () => ({
  DiscoverActionBar: ({
    onAdd,
    disabled,
  }: {
    onAdd: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onAdd}>
      add
    </button>
  ),
}));

describe("DiscoverDeck", () => {
  it("stays interactive on the same card when the add tray is dismissed", async () => {
    deck.addCurrent.mockResolvedValue(false);
    render(<DiscoverDeck />);
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(deck.addCurrent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("add")).toBeEnabled());
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(deck.addCurrent).toHaveBeenCalledTimes(2));
  });

  it("stays locked while the card is advancing", async () => {
    deck.addCurrent.mockResolvedValue(true);
    render(<DiscoverDeck />);
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(deck.addCurrent).toHaveBeenCalled());
    expect(screen.getByText("add")).toBeDisabled();
  });
});
