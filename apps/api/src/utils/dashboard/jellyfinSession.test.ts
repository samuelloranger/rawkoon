import { describe, expect, it } from "bun:test";
import { mapJellyfinSessions } from "@rawkoon/api/utils/dashboard/jellyfin";

const config = { api_key: "key", website_url: "https://jelly.example.com" };

const rawSessions: unknown[] = [
  {
    Id: "s1",
    UserName: "sam",
    DeviceName: "TV",
    NowPlayingItem: {
      Type: "Movie",
      Name: "Dune",
      Id: "m1",
      RunTimeTicks: 1000,
      ImageTags: { Primary: "tagX" },
    },
    PlayState: { PositionTicks: 500, IsPaused: false },
  },
  {
    Id: "s2",
    UserName: "alex",
    DeviceName: "Phone",
    NowPlayingItem: {
      Type: "Episode",
      Name: "Pilot",
      SeriesName: "Severance",
      ParentIndexNumber: 1,
      IndexNumber: 2,
      Id: "e1",
      RunTimeTicks: 2000,
    },
    PlayState: { PositionTicks: 200, IsPaused: true },
  },
  {
    Id: "s3",
    UserName: "idle",
    DeviceName: "Laptop",
  },
];

describe("mapJellyfinSessions", () => {
  it("maps active sessions and filters idle ones", () => {
    const result = mapJellyfinSessions(rawSessions, config);

    expect(result).toHaveLength(2);

    expect(result[0]).toMatchObject({
      session_id: "s1",
      user: "sam",
      device: "TV",
      title: "Dune",
      progress_pct: 50,
      paused: false,
    });
    expect(typeof result[0]?.poster_url).toBe("string");
    expect(result[0]?.poster_url).not.toBeNull();

    expect(result[1]).toMatchObject({
      session_id: "s2",
      user: "alex",
      device: "Phone",
      title: "Severance · S1E2 · Pilot",
      progress_pct: 10,
      paused: true,
    });
    // Episode has no ImageTags.Primary -> poster_url is null
    expect(result[1]?.poster_url).toBeNull();
  });
});
