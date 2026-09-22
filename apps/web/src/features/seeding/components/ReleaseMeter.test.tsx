import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { ReleaseMeter } from "./ReleaseMeter";

const base: SeedingTorrent = {
  hash: "aa",
  name: "n",
  title: "Film",
  year: 1922,
  kind_label: "movie",
  media_id: 1,
  book_id: null,
  poster_url: null,
  indexer: "Harbor",
  is_private: false,
  badges: [],
  rule: { ratio: 1, seed_time_mins: null },
  rule_source: "public_default",
  ratio: 0.63,
  seeding_time_secs: 3600,
  up_speed: 10,
  size_bytes: 100,
  ratio_pct: 0.63,
  time_pct: null,
  lead: "ratio",
  eta_secs: 120,
  target_met: false,
  owes_seed_time: false,
};

describe("ReleaseMeter", () => {
  it("renders only the ratio bar — seed time is no longer a target", () => {
    render(<ReleaseMeter torrent={base} />);
    expect(
      screen.getByRole("progressbar", { name: "seeding.meter.ratio" }),
    ).toHaveAttribute("aria-valuenow", "63");
    expect(screen.getByText("0.63 / 1.0")).toBeInTheDocument();
    expect(screen.queryByText("seeding.meter.time")).toBeNull();
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });
  it("explains an unreachable ratio target", () => {
    render(<ReleaseMeter torrent={{ ...base, up_speed: 0, eta_secs: null }} />);
    expect(screen.getByText("seeding.eta.idle")).toBeInTheDocument();
  });
  it("announces a met target", () => {
    render(
      <ReleaseMeter torrent={{ ...base, target_met: true, eta_secs: 0 }} />,
    );
    expect(screen.getByText("seeding.eta.met")).toBeInTheDocument();
  });
});
