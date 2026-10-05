import { describe, expect, it } from "bun:test";
import { aiPickBodySchema } from "@rawkoon/api/routes/medias/search/index";

describe("aiPickBodySchema", () => {
  it("treats omitted optional numbers as null", () => {
    const parsed = aiPickBodySchema.parse({
      media_context: { title: "A title", type: "movie" },
      releases: [{ key: "guid-1", title: "A.Title.1080p" }],
    });
    expect(parsed.media_context.year).toBeNull();
    expect(parsed.releases[0]).toEqual({
      key: "guid-1",
      title: "A.Title.1080p",
      size_bytes: null,
      seeders: null,
      score: null,
    });
  });

  it("keeps explicit values and nulls", () => {
    const parsed = aiPickBodySchema.parse({
      media_context: { title: "A title", year: 2009, type: "tv" },
      releases: [
        { key: "k", title: "t", size_bytes: 10, seeders: null, score: 4.5 },
      ],
    });
    expect(parsed.media_context.year).toBe(2009);
    expect(parsed.releases[0]).toMatchObject({
      size_bytes: 10,
      seeders: null,
      score: 4.5,
    });
  });

  it("still rejects wrong types", () => {
    expect(
      aiPickBodySchema.safeParse({
        media_context: { title: "t", type: "movie" },
        releases: [{ key: "k", title: "t", score: "high" }],
      }).success,
    ).toBe(false);
  });
});
