import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { FetcherProvider } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { useImportJellyfinUsers } from "./useJellyfinUserLink";

describe("useImportJellyfinUsers", () => {
  it("invalidates the users and Jellyfin user lists on success", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const fetcher = vi.fn().mockResolvedValue({ created: [], skipped: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FetcherProvider fetcher={fetcher}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FetcherProvider>
    );
    const { result } = renderHook(() => useImportJellyfinUsers(), { wrapper });
    result.current.mutate([{ jellyfin_user_id: "j1", is_admin: false }]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.admin.users(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.admin.jellyfinUsers(),
    });
  });
});
