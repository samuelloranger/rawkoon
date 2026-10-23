import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createQueryClient } from "@/lib/api/queryClient";
import { HttpError } from "@/lib/api/httpClient";
import { FetcherProvider, type Fetcher } from "@/lib/api/context";
import { useJellyfinLogin, useLinkJellyfin } from "./useJellyfinSignIn";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function wrapperFor(fetcher: Fetcher) {
  const client = createQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <FetcherProvider fetcher={fetcher}>{children}</FetcherProvider>
    </QueryClientProvider>
  );
}

const rejectWith = (status: number): Fetcher =>
  (async () => {
    throw new HttpError("nope", status);
  }) as Fetcher;

describe("Jellyfin mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("raises no global toast when sign-in fails with a 401", async () => {
    const { result } = renderHook(() => useJellyfinLogin(), {
      wrapper: wrapperFor(rejectWith(401)),
    });
    await act(async () => {
      await result.current
        .mutateAsync({ username: "a", password: "b" })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("raises no global toast when linking fails with a 429", async () => {
    const { result } = renderHook(() => useLinkJellyfin(), {
      wrapper: wrapperFor(rejectWith(429)),
    });
    await act(async () => {
      await result.current
        .mutateAsync({ username: "a", password: "b" })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
