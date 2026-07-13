import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Fetcher } from "@/lib/api/context";
import { FetcherProvider } from "@/lib/api/context";
import type { DiscoverDeckItem } from "@rawkoon/shared/types";
import { useDiscoverDeck } from "./useDiscoverDeck";

const mutateAsync = vi.fn().mockResolvedValue({ item: { id: 1 } });

vi.mock("@/features/medias/hooks/useAddToLibrary", () => ({
  useAddToLibrary: () => ({ mutateAsync }),
}));
vi.mock("@/features/medias/hooks/useAddToWatchlist", () => ({
  useAddToWatchlist: () => ({ mutateAsync }),
}));
vi.mock("@/features/medias/hooks/useRemoveFromLibrary", () => ({
  useRemoveFromLibrary: () => ({ mutateAsync }),
}));
vi.mock("@/features/medias/hooks/useRemoveFromWatchlist", () => ({
  useRemoveFromWatchlist: () => ({ mutateAsync }),
}));
vi.mock("./useDismissMedia", () => ({
  useDismissMedia: () => ({ mutateAsync }),
}));
vi.mock("./useUndismissMedia", () => ({
  useUndismissMedia: () => ({ mutateAsync }),
}));

function item(tmdb_id: number): DiscoverDeckItem {
  return {
    id: `movie-${tmdb_id}`,
    tmdb_id,
    media_type: "movie",
    title: `T${tmdb_id}`,
    release_year: null,
    poster_url: null,
    overview: null,
    vote_average: null,
    genre_ids: [],
  };
}

function wrapper(fetcher: Fetcher) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <FetcherProvider fetcher={fetcher}>{children}</FetcherProvider>;
  };
}

describe("useDiscoverDeck", () => {
  it("keeps a refilled batch when React applies its queued update after served ids change", async () => {
    let resolveRefill!: (value: {
      items: DiscoverDeckItem[];
      source: "trending";
    }) => void;
    const refill = new Promise<{
      items: DiscoverDeckItem[];
      source: "trending";
    }>((resolve) => {
      resolveRefill = resolve;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item(1), item(2), item(3), item(4), item(5)],
        source: "trending",
      })
      .mockReturnValueOnce(refill) as unknown as Fetcher;

    const { result } = renderHook(() => useDiscoverDeck(), {
      wrapper: wrapper(fetcher),
    });

    await waitFor(() => expect(result.current.current?.tmdb_id).toBe(1));
    act(() => result.current.dismissCurrent());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.current?.tmdb_id).toBe(2));
    act(() => result.current.dismissCurrent());
    await waitFor(() => expect(result.current.current?.tmdb_id).toBe(3));
    act(() => result.current.dismissCurrent());
    await waitFor(() => expect(result.current.current?.tmdb_id).toBe(4));
    act(() => result.current.dismissCurrent());
    await waitFor(() => expect(result.current.current?.tmdb_id).toBe(5));
    act(() => result.current.dismissCurrent());

    await act(async () => {
      resolveRefill({ items: [item(6)], source: "trending" });
    });

    await waitFor(() => expect(result.current.current?.tmdb_id).toBe(6));
  });
});
