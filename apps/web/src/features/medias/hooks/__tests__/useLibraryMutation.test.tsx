import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FetcherProvider, type Fetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { useLibraryMutation } from "@/features/medias/hooks/useLibraryMutation";

describe("useLibraryMutation", () => {
  it("returns the response, invalidates library.all and the extra keys", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: 1 });
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <FetcherProvider fetcher={fetcher as unknown as Fetcher}>
          {children}
        </FetcherProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useLibraryMutation<number, { ok: number }>(
          (id) => [`/x/${id}`, { method: "POST" }],
          { invalidate: () => [queryKeys.dashboard.all] },
        ),
      { wrapper },
    );

    let data: { ok: number } | undefined;
    await act(async () => {
      data = await result.current.mutateAsync(7);
    });

    expect(data).toEqual({ ok: 1 });
    expect(fetcher).toHaveBeenCalledWith("/x/7", { method: "POST" });
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
      expect(keys).toContainEqual(queryKeys.library.all);
      expect(keys).toContainEqual(queryKeys.dashboard.all);
    });
  });
});
