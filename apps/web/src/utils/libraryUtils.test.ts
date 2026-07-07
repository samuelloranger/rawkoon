import { describe, expect, it } from "vitest";
import { sortItems } from "./libraryUtils";
import type { LibraryMedia } from "@rawkoon/shared/types";

function makeMedia(overrides: Partial<LibraryMedia>): LibraryMedia {
  return {
    id: 1,
    tmdb_id: 1,
    type: "movie",
    title: "Test",
    sort_title: null,
    year: 2020,
    status: "wanted",
    monitored: true,
    poster_url: null,
    overview: null,
    digital_release_date: null,
    quality_profile_id: null,
    search_attempts: 0,
    quality_profile: null,
    added_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    last_grabbed_at: null,
    total_size_bytes: null,
    resolution: null,
    video_codec: null,
    hdr_format: null,
    audio_format: null,
    duration_secs: null,
    language_tags: [],
    overrides: {},
    episode_count: null,
    downloaded_episode_count: null,
    season_count: null,
    ...overrides,
  };
}

describe("sortItems — digital_release_date", () => {
  it("sorts ascending by digital release date", () => {
    const items = [
      makeMedia({ id: 1, digital_release_date: "2023-06-01T00:00:00.000Z" }),
      makeMedia({ id: 2, digital_release_date: "2021-01-01T00:00:00.000Z" }),
      makeMedia({ id: 3, digital_release_date: "2025-12-01T00:00:00.000Z" }),
    ];
    const result = sortItems(items, "digital_release_date", "asc");
    expect(result.map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it("sorts descending by digital release date", () => {
    const items = [
      makeMedia({ id: 1, digital_release_date: "2023-06-01T00:00:00.000Z" }),
      makeMedia({ id: 2, digital_release_date: "2021-01-01T00:00:00.000Z" }),
    ];
    const result = sortItems(items, "digital_release_date", "desc");
    expect(result.map((i) => i.id)).toEqual([1, 2]);
  });

  it("places null release dates last when sorting ascending", () => {
    const items = [
      makeMedia({ id: 1, digital_release_date: null }),
      makeMedia({ id: 2, digital_release_date: "2023-06-01T00:00:00.000Z" }),
    ];
    const result = sortItems(items, "digital_release_date", "asc");
    expect(result.map((i) => i.id)).toEqual([2, 1]);
  });
});

describe("sortItems — file_size", () => {
  it("sorts ascending by file size", () => {
    const items = [
      makeMedia({ id: 1, total_size_bytes: "5000000000" }),
      makeMedia({ id: 2, total_size_bytes: "1000000000" }),
      makeMedia({ id: 3, total_size_bytes: "20000000000" }),
    ];
    const result = sortItems(items, "file_size", "asc");
    expect(result.map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it("sorts descending by file size", () => {
    const items = [
      makeMedia({ id: 1, total_size_bytes: "5000000000" }),
      makeMedia({ id: 2, total_size_bytes: "20000000000" }),
    ];
    const result = sortItems(items, "file_size", "desc");
    expect(result.map((i) => i.id)).toEqual([2, 1]);
  });

  it("places null sizes last when sorting ascending", () => {
    const items = [
      makeMedia({ id: 1, total_size_bytes: null }),
      makeMedia({ id: 2, total_size_bytes: "5000000000" }),
    ];
    const result = sortItems(items, "file_size", "asc");
    expect(result.map((i) => i.id)).toEqual([2, 1]);
  });
});
