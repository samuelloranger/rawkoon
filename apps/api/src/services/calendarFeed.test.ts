import { describe, expect, it } from "bun:test";
import {
  buildCalendarEvents,
  foldLine,
  renderCalendar,
} from "@rawkoon/api/services/calendarFeed";

const show = {
  id: 7,
  title: "The Show",
  overview: "A show.",
  overrides: null,
  titles: [{ language: "fr", title: "La Série" }],
};

const episode = (
  season: number,
  number: number,
  airDate: string,
  status = "wanted",
  title: string | null = null,
) => ({
  season,
  episode: number,
  title,
  status,
  airDate: new Date(`${airDate}T00:00:00Z`),
  media: show,
});

const movie = (status = "wanted") => ({
  id: 9,
  title: "The Movie",
  overview: null,
  overrides: null,
  titles: [],
  status,
  digitalReleaseDate: new Date("2026-11-03T00:00:00Z"),
});

const BASE = "https://rawkoon.example/";

describe("buildCalendarEvents", () => {
  it("names a single episode with its code and title", () => {
    const [event] = buildCalendarEvents(
      [episode(2, 5, "2026-11-01", "wanted", "Pilot")],
      [],
      "en",
      BASE,
    );
    expect(event).toEqual({
      uid: "tv-7-2026-11-01@rawkoon",
      date: "2026-11-01",
      summary: "The Show — S02E05 · Pilot",
      description: "A show.",
      url: "https://rawkoon.example/library/7",
    });
  });

  it("groups a same-day season drop into one event with the range", () => {
    const events = buildCalendarEvents(
      [3, 1, 2].map((n) => episode(1, n, "2026-11-01")),
      [],
      "en",
      BASE,
    );
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("The Show — S01E01–E03 (3 episodes)");
  });

  it("spells out both seasons when a range crosses one", () => {
    const [event] = buildCalendarEvents(
      [episode(1, 10, "2026-11-01"), episode(2, 1, "2026-11-01")],
      [],
      "en",
      BASE,
    );
    expect(event.summary).toBe("The Show — S01E10–S02E01 (2 episodes)");
  });

  it("checks a group only once every episode is on disk", () => {
    const partial = buildCalendarEvents(
      [episode(1, 1, "2026-11-01", "downloaded"), episode(1, 2, "2026-11-01")],
      [],
      "en",
      BASE,
    );
    expect(partial[0].summary.startsWith("✓")).toBe(false);
    const full = buildCalendarEvents(
      [episode(1, 1, "2026-11-01", "downloaded")],
      [movie("upgrading")],
      "en",
      BASE,
    );
    expect(full.map((e) => e.summary)).toEqual([
      "✓ The Show — S01E01",
      "✓ The Movie — Digital release",
    ]);
  });

  it("uses the locale's title and labels, falling back to the stored title", () => {
    const events = buildCalendarEvents(
      [episode(1, 1, "2026-11-01"), episode(1, 2, "2026-11-01")],
      [movie()],
      "fr",
      BASE,
    );
    expect(events.map((e) => e.summary)).toEqual([
      "La Série — S01E01–E02 (2 épisodes)",
      "The Movie — Sortie numérique",
    ]);
  });

  it("prefers a manual title override", () => {
    const [event] = buildCalendarEvents(
      [
        {
          ...episode(1, 1, "2026-11-01"),
          media: { ...show, overrides: { title: "Custom" } },
        },
      ],
      [],
      "fr",
      BASE,
    );
    expect(event.summary).toBe("Custom — S01E01");
  });
});

describe("renderCalendar", () => {
  const now = new Date("2026-10-10T12:34:56Z");

  it("writes all-day events with CRLF endings and escaped text", () => {
    const ics = renderCalendar(
      [
        {
          uid: "movie-9@rawkoon",
          date: "2026-12-31",
          summary: "A; B, C",
          description: "Line one\nLine two\rLine three\r\nLine four",
          url: "https://rawkoon.example/library/9",
        },
      ],
      "en",
      now,
    );
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n")).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT6H");
    expect(ics).toContain("DTSTAMP:20261010T123456Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
    expect(ics).toContain("SUMMARY:A\\; B\\, C");
    expect(ics).toContain(
      "DESCRIPTION:Line one\\nLine two\\nLine three\\nLine four\\n\\nhttps://rawko",
    );
  });
});

describe("foldLine", () => {
  it("keeps every physical line within 75 octets without splitting characters", () => {
    const folded = foldLine(`SUMMARY:${"é".repeat(100)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(
      `SUMMARY:${"é".repeat(100)}`,
    );
  });

  it("leaves short lines alone", () => {
    expect(foldLine("VERSION:2.0")).toBe("VERSION:2.0");
  });
});
