import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FetcherProvider, type Fetcher } from "@/lib/api/context";
import { useAiPick } from "@/pages/medias/_component/useAiPick";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";

const release = {
  guid: "g1",
  title: "Show.S02E05.1080p",
  rejected: false,
  size_bytes: 1,
  seeders: 2,
  quality_score: 3,
} as unknown as InteractiveReleaseItem;

function run(extra: { season?: number | null; episode?: number | null }) {
  const fetcher = vi.fn(async () => ({
    release_key: "g1",
    reasoning: "",
  })) as unknown as Fetcher;
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <FetcherProvider fetcher={fetcher}>{children}</FetcherProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useAiPick({
        enabled: true,
        releases: [release],
        mediaTitle: "Show",
        mediaYear: 2020,
        mediaType: "tv",
        libraryMediaId: 7,
        ...extra,
      }),
    { wrapper },
  );
  return { fetcher, hook };
}

describe("useAiPick", () => {
  it("sends the target season and episode in media_context", async () => {
    const { fetcher, hook } = run({ season: 2, episode: 5 });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const call = (fetcher as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown as [string, { body: { media_context: unknown } }];
    expect(call[1].body.media_context).toEqual({
      title: "Show",
      year: 2020,
      type: "tv",
      season: 2,
      episode: 5,
    });
  });

  it("sends a season pack as season with a null episode", async () => {
    const { fetcher, hook } = run({ season: 3, episode: null });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const call = (fetcher as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown as [string, { body: { media_context: unknown } }];
    expect(call[1].body.media_context).toMatchObject({
      season: 3,
      episode: null,
    });
  });

  it("omits season and episode when unknown", async () => {
    const { fetcher, hook } = run({});
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const call = (fetcher as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown as [string, { body: { media_context: object } }];
    expect(call[1].body.media_context).not.toHaveProperty("season");
  });
});
