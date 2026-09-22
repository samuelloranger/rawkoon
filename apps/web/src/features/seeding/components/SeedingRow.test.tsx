import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SeedingTorrent } from "@rawkoon/shared/types";

const confirmMock = vi.fn();
vi.mock("@/components/confirm/ConfirmContext", () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));
vi.mock("@/features/seeding/hooks/useSeeding", () => ({
  useReleaseTorrent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SeedingRow } from "./SeedingRow";

const row = (o: Partial<SeedingTorrent> = {}): SeedingTorrent => ({
  hash: "aa",
  name: "n",
  title: "Film",
  year: 1922,
  kind_label: "movie",
  media_id: 1,
  book_id: null,
  poster_url: null,
  indexer: "Nimbus",
  is_private: true,
  badges: ["removed_from_library"],
  rule: { ratio: 1, seed_time_mins: 4320 },
  rule_source: "private_default",
  ratio: 0.2,
  seeding_time_secs: 3600,
  up_speed: 10,
  size_bytes: 100,
  ratio_pct: 0.2,
  time_pct: 1 / 72,
  lead: "time",
  eta_secs: 3600,
  target_met: false,
  owes_seed_time: true,
  ...o,
});

function openedDescription(): ReactNode {
  fireEvent.click(screen.getByRole("button", { name: "seeding.removeNow" }));
  return confirmMock.mock.calls[0][0].description as ReactNode;
}

describe("SeedingRow", () => {
  beforeEach(() => confirmMock.mockClear());

  it("shows badges and warns about a hit-and-run when seed time is owed", () => {
    render(
      <ul>
        <SeedingRow torrent={row()} />
      </ul>,
    );
    expect(
      screen.getByText("seeding.badges.removed_from_library"),
    ).toBeInTheDocument();
    expect(screen.getByText("seeding.badges.owes")).toBeInTheDocument();
    render(<>{openedDescription()}</>);
    expect(screen.getByText(/^seeding\.confirmHnr/)).toBeInTheDocument();
  });

  it("omits the warning once nothing is owed", () => {
    render(
      <ul>
        <SeedingRow
          torrent={row({ owes_seed_time: false, is_private: false })}
        />
      </ul>,
    );
    render(<>{openedDescription()}</>);
    expect(screen.queryByText(/^seeding\.confirmHnr/)).toBeNull();
  });

  it("explains an idle torrent without pointing at a seed-time target", () => {
    render(
      <ul>
        <SeedingRow
          torrent={row({
            up_speed: 0,
            eta_secs: null,
            rule: { ratio: 1, seed_time_mins: null },
            owes_seed_time: false,
          })}
        />
      </ul>,
    );
    expect(screen.getByText("seeding.idleHint")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
