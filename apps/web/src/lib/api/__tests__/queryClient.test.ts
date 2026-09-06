import { describe, expect, it, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import {
  MutationObserver,
  type MutationObserverOptions,
} from "@tanstack/react-query";
import { QUERY_DEFAULTS, createQueryClient } from "@/lib/api/queryClient";
import { HttpError } from "@/lib/api/httpClient";

async function runMutation(
  client: ReturnType<typeof createQueryClient>,
  options: MutationObserverOptions,
): Promise<void> {
  const observer = new MutationObserver(client, options);
  await observer.mutate().catch(() => undefined);
}

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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

describe("mutation cache onError", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it("toasts HttpError.apiError for fire-and-forget mutations", async () => {
    const client = createQueryClient();
    await runMutation(client, {
      mutationFn: async () => {
        throw new HttpError("nope", 400, undefined, {
          error: "Nope from API",
        });
      },
    });
    expect(toast.error).toHaveBeenCalledWith("Nope from API");
  });

  it("falls back to common.requestFailed when there is no API error", async () => {
    const client = createQueryClient();
    await runMutation(client, {
      mutationFn: async () => {
        throw new Error("network down");
      },
    });
    expect(toast.error).toHaveBeenCalledWith("Request failed");
  });

  it("stays silent when meta.silent is set", async () => {
    const client = createQueryClient();
    await runMutation(client, {
      mutationFn: async () => {
        throw new Error("hidden");
      },
      meta: { silent: true },
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not double-toast when the mutation already has onError", async () => {
    const client = createQueryClient();
    await runMutation(client, {
      mutationFn: async () => {
        throw new Error("handled");
      },
      onError: () => {
        toast.error("call-site");
      },
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("call-site");
  });
});
