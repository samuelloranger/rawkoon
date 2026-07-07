import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNavPosition } from "@/pages/settings/useNavPosition";
import { queryKeys } from "@/lib/queryKeys";

// Minimal wrapper providing a QueryClient with seeded cache
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/api/context", () => ({ useFetcher: () => vi.fn() }));

function makeWrapper(navPosition: string | null | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    queryKeys.auth.me,
    navPosition !== undefined ? { nav_position: navPosition } : null,
  );
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useNavPosition", () => {
  it("defaults to 'left' when nav_position is null", () => {
    const { result } = renderHook(() => useNavPosition(), {
      wrapper: makeWrapper(null),
    });
    expect(result.current.position).toBe("left");
  });

  it("defaults to 'left' when user cache is empty", () => {
    const { result } = renderHook(() => useNavPosition(), {
      wrapper: makeWrapper(undefined),
    });
    expect(result.current.position).toBe("left");
  });

  it("returns the stored position when set", () => {
    const { result } = renderHook(() => useNavPosition(), {
      wrapper: makeWrapper("bottom"),
    });
    expect(result.current.position).toBe("bottom");
  });
});
