import { describe, expect, it } from "vitest";
import {
  SETTINGS_PAGES,
  matchesSettingsQuery,
  visibleSettingsPages,
} from "../settingsPages";

const titleOf = (id: string) => id;

describe("settings page registry", () => {
  it("lists You, Server and System pages exactly as designed", () => {
    const ids = (group: string) =>
      SETTINGS_PAGES.filter((p) => p.group === group).map((p) => p.id);
    expect(ids("you")).toEqual(["profile", "security", "alerts", "app"]);
    expect(ids("server")).toEqual([
      "connections",
      "library",
      "quality",
      "after-download",
      "books",
      "people",
      "general",
      "ai",
    ]);
    expect(ids("system")).toEqual([
      "health",
      "jobs",
      "reencode",
      "clips",
      "downloads",
      "blocklist",
      "ai-usage",
      "updates",
    ]);
  });

  it("shows non-admins only the You group", () => {
    expect(visibleSettingsPages(false).every((p) => p.group === "you")).toBe(
      true,
    );
    expect(visibleSettingsPages(true)).toHaveLength(SETTINGS_PAGES.length);
  });

  it("gives every page a /settings/<id> path", () => {
    for (const p of SETTINGS_PAGES) expect(p.path).toBe(`/settings/${p.id}`);
  });

  it("matches a query against the title and the shared keywords", () => {
    const page = (id: string) => SETTINGS_PAGES.find((p) => p.id === id)!;
    expect(
      matchesSettingsQuery(page("reencode"), titleOf("reencode"), "hevc"),
    ).toBe(true);
    expect(
      matchesSettingsQuery(page("connections"), "Connections", "qbittorrent"),
    ).toBe(true);
    expect(
      matchesSettingsQuery(page("after-download"), "After download", "RATIO"),
    ).toBe(true);
    expect(matchesSettingsQuery(page("profile"), "Profile", "hevc")).toBe(
      false,
    );
    expect(matchesSettingsQuery(page("profile"), "Profile", "  ")).toBe(true);
  });
});
