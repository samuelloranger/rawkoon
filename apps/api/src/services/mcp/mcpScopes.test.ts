import { describe, expect, it } from "bun:test";
import { parseMcpScopes } from "./mcpScopes";

describe("parseMcpScopes", () => {
  it("reads the parsed permissions object from verifyApiKey", () => {
    expect(parseMcpScopes({ mcp: ["read", "admin"] })).toEqual([
      "read",
      "admin",
    ]);
  });

  it("also reads the raw JSON string from the Prisma column", () => {
    expect(parseMcpScopes(JSON.stringify({ mcp: ["request"] }))).toEqual([
      "request",
    ]);
  });

  it("drops unknown and duplicate actions, and stays ordered", () => {
    expect(
      parseMcpScopes({ mcp: ["admin", "read", "admin", "nope", 5] }),
    ).toEqual(["admin", "read"]);
  });

  it("is empty for a plain service key (no mcp entry)", () => {
    expect(parseMcpScopes(null)).toEqual([]);
    expect(parseMcpScopes({})).toEqual([]);
    expect(parseMcpScopes({ other: ["read"] })).toEqual([]);
  });

  it("is empty for legacy garbage in the column", () => {
    expect(parseMcpScopes("not json")).toEqual([]);
    expect(parseMcpScopes('"{\\"mcp\\":\\"read\\"}"')).toEqual([]);
  });
});
