import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useClearReleaseSearch } from "@/pages/books/_hooks/useBooks";

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

describe("useClearReleaseSearch", () => {
  it("removes the cached results instead of refetching them", () => {
    const queryClient = new QueryClient();
    const key = queryKeys.books.releaseSearch(7, "ebook");
    queryClient.setQueryData(key, { releases: [{ guid: "a" }] });

    const { result } = renderHook(() => useClearReleaseSearch(7, "ebook"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current();

    // removeQueries, not invalidateQueries: invalidating would refetch and put
    // the same list straight back on screen.
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });

  it("leaves the other edition's results alone", () => {
    const queryClient = new QueryClient();
    const ebook = queryKeys.books.releaseSearch(7, "ebook");
    const audiobook = queryKeys.books.releaseSearch(7, "audiobook");
    queryClient.setQueryData(ebook, { releases: [] });
    queryClient.setQueryData(audiobook, { releases: [{ guid: "keep" }] });

    const { result } = renderHook(() => useClearReleaseSearch(7, "ebook"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current();

    expect(queryClient.getQueryData(ebook)).toBeUndefined();
    expect(queryClient.getQueryData(audiobook)).toBeDefined();
  });
});
