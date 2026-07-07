import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FetcherProvider, type Fetcher } from "@/lib/api/context";
import { useLibraryStats } from "@/features/medias/hooks/useLibraryStats";

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

const STATS = {
  total_movies: 12,
  total_shows: 5,
  downloaded: 9,
  wanted: 8,
  returning_series: 2,
  storage_used_bytes: 1234,
  counts_by_status_type: [],
  storage_by_resolution: [],
  shows_by_tmdb_status: [],
};

describe("useLibraryStats", () => {
  // Regression: GET /api/library/stats wraps the payload as { stats }.
  // The hook must unwrap it so consumers get a bare LibraryStats.
  it("unwraps the { stats } envelope from /api/library/stats", async () => {
    const fetcher = vi.fn(async (endpoint: string) => {
      expect(endpoint).toBe("/api/library/stats");
      return { stats: STATS };
    }) as unknown as Fetcher;

    const { result } = renderHook(() => useLibraryStats(), {
      wrapper: createWrapper(fetcher),
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.total_movies).toBe(12);
    expect(result.current.data?.storage_used_bytes).toBe(1234);
  });
});
