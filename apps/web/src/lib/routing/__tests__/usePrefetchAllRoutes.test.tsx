import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { preloadRoute } = vi.hoisted(() => ({ preloadRoute: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ preloadRoute }),
}));
vi.mock("@/lib/routing/navigation", () => ({
  navSections: [{ items: [{ path: "/" }, { path: "/library" }] }],
}));

import { usePrefetchAllRoutes } from "@/lib/routing/usePrefetchAllRoutes";

describe("usePrefetchAllRoutes", () => {
  beforeEach(() => {
    preloadRoute.mockClear();
    // force the setTimeout fallback path for deterministic timing
    // @ts-expect-error remove rIC so the hook uses setTimeout
    delete globalThis.requestIdleCallback;
    vi.useFakeTimers();
  });

  it("does NOT preload routes synchronously when invoked", () => {
    const { result } = renderHook(() => usePrefetchAllRoutes());
    result.current();
    expect(preloadRoute).not.toHaveBeenCalled();
  });

  it("preloads each nav route once on idle", () => {
    const { result } = renderHook(() => usePrefetchAllRoutes());
    result.current();
    vi.runAllTimers();
    expect(preloadRoute).toHaveBeenCalledTimes(2);
  });
});
