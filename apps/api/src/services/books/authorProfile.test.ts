import { describe, expect, it } from "bun:test";

import { authorProfileFill } from "@rawkoon/api/services/books/authorProfile";

describe("authorProfileFill", () => {
  const empty = { bio: null, imageUrl: null };

  it("fills both fields when the author has none", () => {
    expect(
      authorProfileFill(empty, { bio: "A life.", imageUrl: "http://img" }),
    ).toEqual({ bio: "A life.", imageUrl: "http://img" });
  });

  it("never overwrites a populated field", () => {
    expect(
      authorProfileFill(
        { bio: "kept", imageUrl: "http://kept" },
        { bio: "new", imageUrl: "http://new" },
      ),
    ).toEqual({});
  });

  it("fills only the empty side", () => {
    expect(
      authorProfileFill(
        { bio: "kept", imageUrl: null },
        { bio: "ignored", imageUrl: "http://new" },
      ),
    ).toEqual({ imageUrl: "http://new" });
  });

  it("treats missing incoming values as nothing to write", () => {
    expect(authorProfileFill(empty, {})).toEqual({});
    expect(
      authorProfileFill(empty, { bio: null, imageUrl: undefined }),
    ).toEqual({});
  });

  it("treats blank/whitespace incoming values as empty", () => {
    expect(authorProfileFill(empty, { bio: "   ", imageUrl: "" })).toEqual({});
  });

  it("treats a blank existing value as empty and fills over it", () => {
    expect(
      authorProfileFill({ bio: "  ", imageUrl: null }, { bio: "real" }),
    ).toEqual({ bio: "real" });
  });
});
