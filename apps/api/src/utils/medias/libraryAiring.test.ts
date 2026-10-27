import { describe, expect, it } from "bun:test";

import {
  isAiring,
  parseLibraryStatusInput,
  presentLibraryStatus,
} from "./libraryAiring";

describe("isAiring", () => {
  it.each([
    ["Returning Series", true],
    ["In Production", true],
    ["Planned", true],
    ["Ended", false],
    ["Canceled", false],
    ["Pilot", false],
    ["returning", false],
    ["toString", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("%s -> %p", (tmdbStatus, expected) => {
    expect(isAiring(tmdbStatus)).toBe(expected);
  });
});

describe("presentLibraryStatus", () => {
  it.each([
    ["Returning Series", "returning"],
    ["In Production", "in_production"],
    ["Planned", "planned"],
  ])("shows a downloaded show as %s when TMDB says %s", (tmdb, legacy) => {
    expect(
      presentLibraryStatus({
        status: "downloaded",
        type: "show",
        tmdbStatus: tmdb,
      }),
    ).toBe(legacy);
  });

  it.each([null, "Ended", "Canceled", "Pilot", "toString"])(
    "keeps a downloaded show downloaded when tmdbStatus is %p",
    (tmdbStatus) => {
      expect(
        presentLibraryStatus({
          status: "downloaded",
          type: "show",
          tmdbStatus,
        }),
      ).toBe("downloaded");
    },
  );

  it.each(["wanted", "downloading", "upgrading", "skipped"])(
    "never rewrites the acquisition status %s of an airing show",
    (status) => {
      expect(
        presentLibraryStatus({
          status,
          type: "show",
          tmdbStatus: "Returning Series",
        }),
      ).toBe(status);
    },
  );

  it("never rewrites a movie, whatever its tmdbStatus", () => {
    expect(
      presentLibraryStatus({
        status: "downloaded",
        type: "movie",
        tmdbStatus: "Returning Series",
      }),
    ).toBe("downloaded");
  });

  it("passes an already-composite stored value through", () => {
    expect(
      presentLibraryStatus({
        status: "returning",
        type: "show",
        tmdbStatus: "Returning Series",
      }),
    ).toBe("returning");
  });
});

describe("parseLibraryStatusInput", () => {
  it("maps a composite value to downloaded plus the raw TMDB status", () => {
    expect(parseLibraryStatusInput("returning")).toEqual({
      status: "downloaded",
      airing: "yes",
      tmdbStatus: "Returning Series",
    });
    expect(parseLibraryStatusInput("in_production")).toEqual({
      status: "downloaded",
      airing: "yes",
      tmdbStatus: "In Production",
    });
    expect(parseLibraryStatusInput("planned")).toEqual({
      status: "downloaded",
      airing: "yes",
      tmdbStatus: "Planned",
    });
  });

  it("narrows plain downloaded to not airing", () => {
    expect(parseLibraryStatusInput("downloaded")).toEqual({
      status: "downloaded",
      airing: "no",
    });
  });

  it("leaves other statuses alone", () => {
    expect(parseLibraryStatusInput("wanted")).toEqual({
      status: "wanted",
      airing: "any",
    });
  });
});
