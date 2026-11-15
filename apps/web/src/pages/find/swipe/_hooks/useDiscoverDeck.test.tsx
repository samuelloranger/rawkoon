import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Fetcher } from "@/lib/api/context";
import { FetcherProvider } from "@/lib/api/context";
import type { DiscoverDeckItem } from "@rawkoon/shared/types";
import { toast } from "sonner";
import { useDiscoverDeck } from "./useDiscoverDeck";

const mutateAsync = vi.fn().mockResolvedValue({ item: { id: 1 } });
const addMock = vi.fn().mockResolvedValue({ item: { id: 1 } });
const requestMock = vi.fn().mockResolvedValue(true);
let isAdmin = true;

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { is_admin: isAdmin } }),
}));
vi.mock("@/features/add/useAddFlow", () => ({
  useAddFlow: () => ({ add: addMock, request: requestMock }),
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

  describe("addCurrent", () => {
    const fetcher = () =>
      vi.fn().mockResolvedValue({
        items: [item(1), item(2), item(3)],
        source: "trending",
      }) as unknown as Fetcher;
    const mount = async (admin: boolean) => {
      isAdmin = admin;
      addMock.mockClear();
      requestMock.mockClear();
      const hook = renderHook(() => useDiscoverDeck(), {
        wrapper: wrapper(fetcher()),
      });
      await waitFor(() => expect(hook.result.current.current?.tmdb_id).toBe(1));
      return hook.result;
    };

    it("adds through the compact tray for an admin and advances with undo", async () => {
      const result = await mount(true);
      let advanced = false;
      await act(async () => {
        advanced = await result.current.addCurrent();
      });
      expect(addMock).toHaveBeenCalledWith(
        expect.objectContaining({ tmdb_id: 1, media_type: "movie" }),
        { compact: true },
      );
      expect(advanced).toBe(true);
      expect(requestMock).not.toHaveBeenCalled();
      await waitFor(() => expect(result.current.current?.tmdb_id).toBe(2));
      expect(result.current.canUndo).toBe(true);
    });

    it("keeps the card when the admin dismisses the tray", async () => {
      const result = await mount(true);
      addMock.mockResolvedValueOnce(null);
      let advanced = false;
      await act(async () => {
        advanced = await result.current.addCurrent();
      });
      expect(advanced).toBe(false);
      expect(result.current.current?.tmdb_id).toBe(1);
    });

    it("files a request for a non-admin and advances without undo", async () => {
      const result = await mount(false);
      let advanced = false;
      await act(async () => {
        advanced = await result.current.addCurrent();
      });
      expect(advanced).toBe(true);
      expect(requestMock).toHaveBeenCalledWith({
        tmdb_id: 1,
        type: "movie",
        title: "T1",
        poster_url: null,
        year: null,
      });
      expect(addMock).not.toHaveBeenCalled();
      await waitFor(() => expect(result.current.current?.tmdb_id).toBe(2));
      expect(result.current.canUndo).toBe(false);
      expect(toast.success).toHaveBeenCalled();
      isAdmin = true;
    });

    it("keeps the card when the request is cancelled or fails", async () => {
      const result = await mount(false);
      requestMock.mockResolvedValueOnce(false);
      let advanced = false;
      await act(async () => {
        advanced = await result.current.addCurrent();
      });
      expect(advanced).toBe(false);
      expect(result.current.current?.tmdb_id).toBe(1);
      expect(toast.success).not.toHaveBeenCalled();
      isAdmin = true;
    });
  });
});
