import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SeedingResponse } from "@rawkoon/shared/types";
import { queryKeys } from "@/lib/queryKeys";
import { useLibraryEvents } from "./useLibraryEvents";

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  close() {}
}

describe("useLibraryEvents seed-state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("patches the cached Seeding list from a seed-state push", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const client = new QueryClient();
    const seeding: SeedingResponse = {
      enabled: true,
      released_today: [],
      torrents: [
        {
          hash: "aa",
          name: "n",
          title: "Film",
          year: null,
          kind_label: "movie",
          media_id: 1,
          book_id: null,
          poster_url: null,
          indexer: "Harbor",
          is_private: false,
          badges: [],
          rule: { ratio: 1, seed_time_mins: null },
          rule_source: "public_default",
          ratio: 0.2,
          seeding_time_secs: 10,
          up_speed: 1,
          size_bytes: 10,
          ratio_pct: 0.2,
          time_pct: null,
          lead: "ratio",
          eta_secs: 100,
          target_met: false,
          owes_seed_time: false,
        },
      ],
    };
    client.setQueryData(queryKeys.downloads.seeding(false), seeding);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useLibraryEvents(), { wrapper });

    FakeEventSource.last?.onmessage?.({
      data: JSON.stringify({
        kind: "seed-state",
        ts: 1,
        torrents: [
          {
            hash: "aa",
            ratio: 0.6,
            seedingTimeSecs: 20,
            upSpeed: 2,
            etaSecs: 40,
          },
        ],
      }),
    });

    const next = client.getQueryData<SeedingResponse>(
      queryKeys.downloads.seeding(false),
    );
    expect(next?.torrents[0]).toMatchObject({
      ratio: 0.6,
      eta_secs: 40,
      up_speed: 2,
    });
  });
});
