import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { QUERY_DEFAULTS } from "@/lib/api/queryClient";
import { FetcherProvider, type Fetcher } from "@/lib/api/context";
import { useInfiniteLibrary } from "@/features/medias/hooks/useInfiniteLibrary";

/**
 * Reproduces the reported flow exactly: delete an item on a detail page, which
 * invalidates the list while the list is UNMOUNTED, then navigate back and
 * expect the item to be gone without pressing refresh.
 *
 * Uses the real QUERY_DEFAULTS rather than a hand-written copy — the whole bug
 * was a wrong default, so a test that mirrors the defaults by hand would have
 * happily passed while production stayed broken.
 */

const page = (titles: string[]) => ({
  items: titles.map((title, i) => ({ id: i + 1, title })),
  movie_count: titles.length,
  show_count: 0,
  has_more: false,
});

function harness(fetcher: Fetcher) {
  const queryClient = new QueryClient({
    defaultOptions: {
      ...QUERY_DEFAULTS,
      queries: { ...QUERY_DEFAULTS.queries, retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <FetcherProvider fetcher={fetcher}>{children}</FetcherProvider>
    </QueryClientProvider>
  );
  return { queryClient, Wrapper };
}

const titlesOf = (
  data: { pages: { items: { title: string }[] }[] } | undefined,
) => data?.pages.flatMap((p) => p.items.map((i) => i.title)) ?? [];

describe("library list after an invalidation from elsewhere", () => {
  it("drops a deleted item on remount without a manual refresh", async () => {
    let server = ["The Odyssey", "Another Film"];
    const fetcher = vi.fn(() =>
      Promise.resolve(page(server)),
    ) as unknown as Fetcher;
    const { queryClient, Wrapper } = harness(fetcher);

    // 1. The list is open and shows both items.
    const first = renderHook(() => useInfiniteLibrary({ sortBy: "added_at" }), {
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(titlesOf(first.result.current.data)).toContain("The Odyssey"),
    );

    // 2. The user opens the detail page, so the list unmounts.
    first.unmount();

    // 3. The delete succeeds and its mutation invalidates the list. Nothing
    //    refetches now, because an unmounted query is only marked stale.
    server = ["Another Film"];
    await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });

    // 4. Back to the list.
    const second = renderHook(
      () => useInfiniteLibrary({ sortBy: "added_at" }),
      {
        wrapper: Wrapper,
      },
    );

    await waitFor(() =>
      expect(titlesOf(second.result.current.data)).not.toContain("The Odyssey"),
    );
    expect(titlesOf(second.result.current.data)).toEqual(["Another Film"]);
  });

  it("drops it even though the route loader runs ensureInfiniteQueryData first", async () => {
    // The /library route loader awaits ensureInfiniteQueryData before the page
    // mounts. ensure* returns cached data without revalidating when data is
    // already present, so if it also cleared the invalidated flag the mount
    // would never refetch and the deleted item would survive. This pins that
    // behaviour down.
    let server = ["The Odyssey", "Another Film"];
    const fetcher = vi.fn(() =>
      Promise.resolve(page(server)),
    ) as unknown as Fetcher;
    const { queryClient, Wrapper } = harness(fetcher);

    const first = renderHook(() => useInfiniteLibrary({ sortBy: "added_at" }), {
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(titlesOf(first.result.current.data)).toContain("The Odyssey"),
    );
    first.unmount();

    server = ["Another Film"];
    await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });

    // The route loader, as it actually runs.
    await queryClient.ensureInfiniteQueryData({
      queryKey: queryKeys.library.infinite({ sortBy: "added_at" }),
      queryFn: () => Promise.resolve(page(server)),
      initialPageParam: 1,
      getNextPageParam: () => undefined,
    });

    const second = renderHook(
      () => useInfiniteLibrary({ sortBy: "added_at" }),
      {
        wrapper: Wrapper,
      },
    );
    await waitFor(() =>
      expect(titlesOf(second.result.current.data)).not.toContain("The Odyssey"),
    );
  });

  it("does not refetch when nothing invalidated it, so navigation stays cheap", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(page(["The Odyssey"])),
    ) as unknown as Fetcher;
    const { Wrapper } = harness(fetcher);

    const first = renderHook(() => useInfiniteLibrary({ sortBy: "added_at" }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const callsAfterFirstMount = (
      fetcher as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.length;
    first.unmount();

    // Remount inside staleTime with no invalidation: serve from cache.
    const second = renderHook(
      () => useInfiniteLibrary({ sortBy: "added_at" }),
      {
        wrapper: Wrapper,
      },
    );
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(
      (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsAfterFirstMount);
  });
});
