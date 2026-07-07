import { describe, it, expect } from "bun:test";
import { parseLocalAiPickResponse } from "@rawkoon/api/services/localAi/client";

const candidates = [
  { key: "guid-a", title: "A", size_bytes: null, seeders: null, score: 100 },
  { key: "guid-b", title: "B", size_bytes: null, seeders: null, score: 200 },
];

describe("parseLocalAiPickResponse", () => {
  it("parses valid JSON", () => {
    const result = parseLocalAiPickResponse(
      '{"release_key":"guid-b","reasoning":"Best seeds"}',
      candidates,
    );
    expect(result).toEqual({
      release_key: "guid-b",
      reasoning: "Best seeds",
    });
  });

  it("strips markdown fences", () => {
    const result = parseLocalAiPickResponse(
      '```json\n{"release_key":"guid-a","reasoning":"ok"}\n```',
      candidates,
    );
    expect(result?.release_key).toBe("guid-a");
  });

  it("returns null for unknown release_key", () => {
    expect(
      parseLocalAiPickResponse(
        '{"release_key":"missing","reasoning":"nope"}',
        candidates,
      ),
    ).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseLocalAiPickResponse("not json", candidates)).toBeNull();
  });
});
