import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const useSeedingMock = vi.fn();
vi.mock("@/features/seeding/hooks/useSeeding", () => ({
  useSeeding: () => useSeedingMock(),
  useReleaseTorrent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/confirm/ConfirmContext", () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));

import { SeedingView, filterSeeding } from "./SeedingView";
import type { SeedingTorrent } from "@rawkoon/shared/types";

const r = (hash: string, o: Partial<SeedingTorrent> = {}): SeedingTorrent => ({
  hash,
  name: hash,
  title: `Title ${hash}`,
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
  ratio: 0.5,
  seeding_time_secs: 10,
  up_speed: 5,
  size_bytes: 10,
  ratio_pct: 0.5,
  time_pct: null,
  lead: "ratio",
  eta_secs: 10,
  target_met: false,
  owes_seed_time: false,
  ...o,
});

describe("filterSeeding", () => {
  it("filters by owed, removed and idle", () => {
    const list = [
      r("a", { owes_seed_time: true }),
      r("b", { badges: ["removed_from_library"] }),
      r("c", { up_speed: 0 }),
    ];
    expect(filterSeeding(list, "owed").map((x) => x.hash)).toEqual(["a"]);
    expect(filterSeeding(list, "removed").map((x) => x.hash)).toEqual(["b"]);
    expect(filterSeeding(list, "idle").map((x) => x.hash)).toEqual(["c"]);
    expect(filterSeeding(list, "all")).toHaveLength(3);
  });
});

describe("SeedingView", () => {
  it("shows the off banner, the rows, and the released footer", () => {
    useSeedingMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        enabled: false,
        torrents: [r("a")],
        released_today: [
          {
            hash: "z",
            title: "Old",
            reason: "target_met",
            released_at: "2026-01-01T00:00:00Z",
            size_bytes: 1024,
          },
        ],
      },
    });
    render(<SeedingView />);
    expect(screen.getByText("seeding.disabled.title")).toBeInTheDocument();
    expect(screen.getByText("Title a")).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
  });
  it("switches filters", () => {
    useSeedingMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        enabled: true,
        torrents: [r("a"), r("b", { up_speed: 0 })],
        released_today: [],
      },
    });
    render(<SeedingView />);
    fireEvent.click(screen.getByRole("tab", { name: "seeding.filters.idle" }));
    expect(screen.queryByText("Title a")).toBeNull();
    expect(screen.getByText("Title b")).toBeInTheDocument();
  });
  it("shows the empty state", () => {
    useSeedingMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: { enabled: true, torrents: [], released_today: [] },
    });
    render(<SeedingView />);
    expect(screen.getByText("seeding.empty.title")).toBeInTheDocument();
  });

  it("splits ready-to-release torrents into a folded section apart from the ones still seeding", () => {
    useSeedingMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        enabled: true,
        torrents: [r("a", { target_met: true, eta_secs: 0 }), r("b")],
        released_today: [],
      },
    });
    render(<SeedingView />);
    const ready = screen
      .getByText(/^seeding\.sections\.ready/)
      .closest("details");
    const seeding = screen
      .getByText(/^seeding\.sections\.seeding/)
      .closest("details");
    expect(ready).not.toHaveAttribute("open");
    expect(seeding).toHaveAttribute("open");
    expect(ready).toContainElement(screen.getByText("Title a"));
    expect(seeding).toContainElement(screen.getByText("Title b"));
  });
});
