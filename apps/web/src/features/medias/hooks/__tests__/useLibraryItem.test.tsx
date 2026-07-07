import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { FetcherProvider, type Fetcher } from "@/lib/api/context";
import { useLibraryItem } from "@/features/medias/hooks/useLibraryItem";

// Mirror the production QueryClient defaults (refetchOnMount:false + staleTime).
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnMount: false, staleTime: 30 * 1000 },
    },
  });
}

function createWrapper(fetcher: Fetcher, queryClient = makeClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <FetcherProvider fetcher={fetcher}>{children}</FetcherProvider>
      </QueryClientProvider>
    );
  };
}

const ITEM = {
  id: 123,
  tmdb_id: 999,
  type: "movie" as const,
  title: "Freshly Added Movie",
};

describe("useLibraryItem", () => {
  it("fetches a single library item by id from /api/library/item/:id", async () => {
    const fetcher = vi.fn(async (endpoint: string) => {
      expect(endpoint).toBe("/api/library/item/123");
      return { item: ITEM };
    }) as unknown as Fetcher;

    const { result } = renderHook(() => useLibraryItem(123), {
      wrapper: createWrapper(fetcher),
    });

    await waitFor(() => expect(result.current.data?.item).toBeTruthy());
    expect(result.current.data?.item.title).toBe("Freshly Added Movie");
  });

  it("fetches even with refetchOnMount:false — the by-id key has no stale cache, so a just-added item is always retrieved", async () => {
    const fetcher = vi.fn(async () => ({ item: ITEM })) as unknown as Fetcher;

    const { result } = renderHook(() => useLibraryItem(123), {
      wrapper: createWrapper(fetcher),
    });

    await waitFor(() => expect(result.current.data?.item.id).toBe(123));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("revalidates on mount even when a stale entry is already cached (refetchOnMount:'always')", async () => {
    const client = makeClient();
    client.setQueryData(queryKeys.library.item(123), {
      item: { ...ITEM, status: "wanted" },
    });

    const fetcher = vi.fn(async () => ({
      item: { ...ITEM, status: "downloaded" },
    })) as unknown as Fetcher;

    const { result } = renderHook(() => useLibraryItem(123), {
      wrapper: createWrapper(fetcher, client),
    });

    await waitFor(() =>
      expect(result.current.data?.item.status).toBe("downloaded"),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("is disabled for a non-finite id", () => {
    const fetcher = vi.fn() as unknown as Fetcher;
    const { result } = renderHook(() => useLibraryItem(Number.NaN), {
      wrapper: createWrapper(fetcher),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
