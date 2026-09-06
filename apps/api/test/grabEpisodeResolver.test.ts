import { describe, expect, it } from "bun:test";
import {
  episodeMapKey,
  resolveGrabEpisodeId,
  resolveGrabSeason,
  type GrabEpisodeRef,
} from "../src/services/grabEpisodeResolver";

const EPISODES: GrabEpisodeRef[] = [
  { id: 111, season: 3, episode: 4 },
  { id: 110, season: 3, episode: 5 },
  { id: 112, season: 3, episode: 6 },
];

const map = new Map(
  EPISODES.map((e) => [episodeMapKey(e.season, e.episode), e]),
);

describe("resolveGrabEpisodeId", () => {
  it("passes through when no episode is requested (movie/season pack)", () => {
    const r = resolveGrabEpisodeId({
      requested: null,
      releaseTitle: "Whatever.2024.1080p.WEB",
      episodesBySeasonEpisode: map,
    });
    expect(r).toEqual({ ok: true, episodeId: null, corrected: false });
  });

  it("keeps the requested episode when the release SxxExx matches", () => {
    const r = resolveGrabEpisodeId({
      requested: EPISODES[0],
      releaseTitle: "Bellefleur.S03E04.VFQ.1080p.WEB.H264",
      episodesBySeasonEpisode: map,
    });
    expect(r).toEqual({ ok: true, episodeId: 111, corrected: false });
  });

  it("corrects to the real episode when the release SxxExx differs (the bug)", () => {
    // Panel opened from E04 (id 111) but the grabbed release is S03E05.
    const r = resolveGrabEpisodeId({
      requested: EPISODES[0],
      releaseTitle: "Bellefleur.S03E05.AD.VFQ.1080p.WEB.AC3.5.1.H264-MTLQC",
      episodesBySeasonEpisode: map,
    });
    expect(r).toEqual({ ok: true, episodeId: 110, corrected: true });
  });

  it("rejects when the release SxxExx has no matching library episode", () => {
    const r = resolveGrabEpisodeId({
      requested: EPISODES[0],
      releaseTitle: "Bellefleur.S03E09.1080p.WEB",
      episodesBySeasonEpisode: map,
    });
    expect(r.ok).toBe(false);
  });

  it("keeps the requested episode when the release title has no SxxExx", () => {
    const r = resolveGrabEpisodeId({
      requested: EPISODES[1],
      releaseTitle: "Bellefleur.FRENCH.1080p.WEB",
      episodesBySeasonEpisode: map,
    });
    expect(r).toEqual({ ok: true, episodeId: 110, corrected: false });
  });

  it("keeps the requested episode for a season-only (pack) release title", () => {
    const r = resolveGrabEpisodeId({
      requested: EPISODES[2],
      releaseTitle: "Bellefleur.S03.FRENCH.1080p.WEB",
      episodesBySeasonEpisode: map,
    });
    expect(r).toEqual({ ok: true, episodeId: 112, corrected: false });
  });
});

describe("resolveGrabSeason", () => {
  it("keeps an explicit season for a show pack", () => {
    expect(
      resolveGrabSeason({
        mediaType: "show",
        episodeId: null,
        season: 2,
        releaseTitle: "Show.S02.1080p",
      }),
    ).toBe(2);
  });

  it("infers season from a pack title when the caller omits it", () => {
    expect(
      resolveGrabSeason({
        mediaType: "show",
        episodeId: null,
        season: null,
        releaseTitle: "Show.S02.1080p.WEB-DL",
      }),
    ).toBe(2);
  });

  it("infers season from an SxxExx title grabbed as a pack (no episode id)", () => {
    expect(
      resolveGrabSeason({
        mediaType: "show",
        episodeId: null,
        season: null,
        releaseTitle: "Show.S02E01-E10.COMPLETE.1080p",
      }),
    ).toBe(2);
  });

  it("stays null for movies", () => {
    expect(
      resolveGrabSeason({
        mediaType: "movie",
        episodeId: null,
        season: null,
        releaseTitle: "Movie.2024.1080p",
      }),
    ).toBe(null);
  });

  it("stays null for episode grabs so they do not collide with a season pack", () => {
    expect(
      resolveGrabSeason({
        mediaType: "show",
        episodeId: 77,
        season: 2,
        releaseTitle: "Show.S02E01.1080p",
      }),
    ).toBe(null);
  });
});
