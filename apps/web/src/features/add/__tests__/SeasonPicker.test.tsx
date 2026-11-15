import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SeasonPicker } from "../SeasonPicker";
import { seasonsFromTmdb, type SeasonChoice } from "../seasonPlan";

const seasons = seasonsFromTmdb(
  [
    { season_number: 1, name: "S1", episode_count: 10, air_date: "2020-01-01" },
    { season_number: 2, name: "S2", episode_count: 10, air_date: "2021-01-01" },
    { season_number: 3, name: "S3", episode_count: 10, air_date: "2022-01-01" },
    { season_number: 4, name: "S4", episode_count: 0, air_date: "2999-01-01" },
  ],
  "2026-01-01",
);
const base: SeasonChoice = { mode: "all", picked: [], newSeasons: true };
const summaryOf = (choice: SeasonChoice) => {
  const { container } = render(
    <SeasonPicker seasons={seasons} choice={choice} onChange={vi.fn()} />,
  );
  return container.querySelector("[aria-live=polite]")?.textContent;
};

describe("season summary sentence", () => {
  it("all: every episode of every aired season plus new seasons", () => {
    expect(summaryOf(base)).toBe(
      "addDialog.summary.gets addDialog.summary.episodes count:30 addDialog.summary.fromSeasons list:1–3addDialog.summary.plus addDialog.summary.newSeasons addDialog.summary.asTheyAir",
    );
  });

  it("future: nothing aired, new seasons forced on", () => {
    expect(summaryOf({ ...base, mode: "future", newSeasons: false })).toBe(
      "addDialog.summary.getsNothingaddDialog.summary.plus addDialog.summary.newSeasons addDialog.summary.asTheyAir",
    );
  });

  it("latest: the newest aired season only, no new seasons when off", () => {
    expect(summaryOf({ ...base, mode: "latest", newSeasons: false })).toBe(
      "addDialog.summary.gets addDialog.summary.episodes count:10 addDialog.summary.fromSeason list:3.",
    );
  });

  it("pick: nothing picked and no new seasons asks for a pick", () => {
    expect(summaryOf({ mode: "pick", picked: [], newSeasons: false })).toBe(
      "addDialog.summary.nothing",
    );
  });
});

describe("season strip", () => {
  it("draws one bar per episode and a dashed box for the announced season", () => {
    render(<SeasonPicker seasons={seasons} choice={base} onChange={vi.fn()} />);
    const strip = screen.getByTestId("season-strip");
    expect(strip.querySelectorAll("span.w-1")).toHaveLength(30);
    // New seasons on: the announced season is lit.
    expect(
      strip.querySelector("[aria-label='addDialog.seasonLabel n:4']"),
    ).toHaveAttribute("data-lit", "true");
  });

  it("future mode switch is locked on and the modes are pressable chips", () => {
    const onChange = vi.fn();
    render(
      <SeasonPicker
        seasons={seasons}
        choice={{ ...base, mode: "future", newSeasons: false }}
        onChange={onChange}
      />,
    );
    const sw = screen.getByRole("switch");
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "addDialog.modes.latest" }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "latest" }),
    );
  });
});
