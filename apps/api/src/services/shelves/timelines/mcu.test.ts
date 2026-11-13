import { describe, expect, it } from "bun:test";
import mcuTimeline from "./mcu.json";

const GROUPS = [
  "Origins",
  "The Avengers Assemble",
  "The Infinity Saga",
  "The Multiverse Saga",
];

describe("MCU timeline", () => {
  const entries = mcuTimeline.entries;

  it("is not empty and every entry carries the fields a shelf needs", () => {
    expect(entries.length).toBeGreaterThan(40);
    for (const entry of entries) {
      expect(entry.tmdb_id).toBeGreaterThan(0);
      expect(["movie", "show"]).toContain(entry.type);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(typeof entry.group).toBe("string");
    }
  });

  it("keeps ids unique per (id, type, season) so the shelf has no duplicates", () => {
    const keys = entries.map(
      (entry) =>
        `${entry.type}:${entry.tmdb_id}:${"season" in entry ? entry.season : ""}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives shows a season and leaves movies without one", () => {
    for (const entry of entries) {
      if (entry.type === "show") {
        expect("season" in entry && entry.season).toBeGreaterThan(0);
      } else {
        expect("season" in entry).toBe(false);
      }
    }
  });

  it("uses the known era groups in story order", () => {
    const seen = [...new Set(entries.map((entry) => entry.group))];
    expect(seen).toEqual(GROUPS);
    // Story order is inside a group: Captain America precedes Captain Marvel.
    const titles = entries.map((entry) => entry.title);
    expect(titles.indexOf("Captain America: The First Avenger")).toBeLessThan(
      titles.indexOf("Iron Man"),
    );
    expect(titles.indexOf("Avengers: Endgame")).toBeLessThan(
      titles.indexOf("WandaVision"),
    );
  });

  it("has plausible years", () => {
    for (const entry of entries) {
      expect(entry.year).toBeGreaterThanOrEqual(2008);
      expect(entry.year).toBeLessThanOrEqual(2030);
    }
  });
});
