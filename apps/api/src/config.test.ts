import { describe, expect, it } from "bun:test";
import { parseCorsOrigins } from "@rawkoon/api/config";

describe("parseCorsOrigins", () => {
  it("keeps a single origin", () => {
    expect(parseCorsOrigins("https://a.example")).toEqual([
      "https://a.example",
    ]);
  });
  it("splits a comma-separated list and trims entries", () => {
    expect(
      parseCorsOrigins(" https://a.example , https://b.example,, "),
    ).toEqual(["https://a.example", "https://b.example"]);
  });
  it("falls back to the dev default when blank", () => {
    expect(parseCorsOrigins("")).toEqual(["http://localhost:5173"]);
    expect(parseCorsOrigins(undefined)).toEqual(["http://localhost:5173"]);
  });
});
