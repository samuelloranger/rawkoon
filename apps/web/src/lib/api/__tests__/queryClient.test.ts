import { describe, expect, it } from "vitest";
import { QUERY_DEFAULTS } from "@/lib/api/queryClient";

/**
 * These defaults decide whether a list reflects a mutation made on a detail
 * page. They were wrong once — `refetchOnMount: false` sat next to a comment
 * claiming it meant "only refetch if data is stale" — and the symptom was a
 * deleted item still appearing in the library until the user pressed refresh.
 * Asserting them keeps that from silently regressing.
 */
describe("query client defaults", () => {
  const queries = QUERY_DEFAULTS.queries;

  it("refetches on mount so an invalidated list reloads on the way back", () => {
    // invalidateQueries only refetches MOUNTED queries. A list sitting behind a
    // detail page is merely marked stale, and refetches on remount only if
    // this is true. `false` would strand it.
    expect(queries?.refetchOnMount).toBe(true);
  });

  it("keeps a stale window so back-and-forth navigation does not refetch", () => {
    // Without a staleTime, refetchOnMount: true would refetch on every single
    // navigation and make lists flash.
    expect(queries?.staleTime).toBeGreaterThan(0);
  });

  it("keeps unused data long enough for instant back navigation", () => {
    expect(queries?.gcTime).toBeGreaterThan(queries?.staleTime as number);
  });

  it("does not refetch on window focus or reconnect", () => {
    // Deliberate: this is a self-hosted dashboard that is often left open, and
    // focus-refetching every query was noisy.
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.refetchOnReconnect).toBe(false);
  });
});
