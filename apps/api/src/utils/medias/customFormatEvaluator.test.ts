// apps/api/src/utils/medias/customFormatEvaluator.test.ts
import { describe, expect, test } from "bun:test";
import type { ParsedRelease } from "@rawkoon/api/utils/medias/filenameParser";
import type {
  FormatCondition,
  ReleaseEvalContext,
} from "@rawkoon/api/utils/medias/customFormatTypes";
import {
  conditionMatches,
  formatMatches,
} from "@rawkoon/api/utils/medias/customFormatEvaluator";

function parsed(overrides: Partial<ParsedRelease> = {}): ParsedRelease {
  return {
    resolution: 1080,
    source: "BluRay",
    codec: "x265",
    hdr: null,
    audio: null,
    group: null,
    streaming: null,
    isSample: false,
    isProper: false,
    ...overrides,
  };
}

function ctx(overrides: Partial<ReleaseEvalContext> = {}): ReleaseEvalContext {
  return {
    parsed: parsed(),
    rawTitle: "Some.Movie.2024.1080p.BluRay.x265-GROUP",
    sizeBytes: 5_000_000_000,
    indexerName: "MyTracker",
    seeders: 42,
    freeleech: false,
    ...overrides,
  };
}

const cond = (c: Partial<FormatCondition>): FormatCondition =>
  ({
    type: "title_regex",
    operator: "matches",
    ...c,
  }) as FormatCondition;

describe("conditionMatches", () => {
  test("title_regex matches case-insensitively", () => {
    expect(
      conditionMatches(
        cond({ type: "title_regex", operator: "matches", value: "bluray" }),
        ctx(),
      ),
    ).toBe(true);
  });

  test("release_group matches parsed group", () => {
    expect(
      conditionMatches(
        cond({ type: "release_group", operator: "matches", value: "^GROUP$" }),
        ctx({ parsed: parsed({ group: "GROUP" }) }),
      ),
    ).toBe(true);
  });

  test("seeders gte passes/fails", () => {
    expect(
      conditionMatches(
        cond({ type: "seeders", operator: "gte", value: 10 }),
        ctx({ seeders: 42 }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        cond({ type: "seeders", operator: "gte", value: 100 }),
        ctx({ seeders: 42 }),
      ),
    ).toBe(false);
  });

  test("seeders with null value never matches a numeric op", () => {
    expect(
      conditionMatches(
        cond({ type: "seeders", operator: "gte", value: 1 }),
        ctx({ seeders: null }),
      ),
    ).toBe(false);
  });

  test("size_range between (GB) inclusive", () => {
    expect(
      conditionMatches(
        cond({ type: "size_range", operator: "between", value: [1, 10] }),
        ctx({ sizeBytes: 5_000_000_000 }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        cond({ type: "size_range", operator: "between", value: [6, 10] }),
        ctx({ sizeBytes: 5_000_000_000 }),
      ),
    ).toBe(false);
  });

  test("hdr_flag is_true", () => {
    expect(
      conditionMatches(
        cond({ type: "hdr_flag", operator: "is_true" }),
        ctx({ parsed: parsed({ hdr: "HDR10" }) }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(cond({ type: "hdr_flag", operator: "is_true" }), ctx()),
    ).toBe(false);
  });

  test("indexer equals (case-insensitive)", () => {
    expect(
      conditionMatches(
        cond({ type: "indexer", operator: "equals", value: "mytracker" }),
        ctx(),
      ),
    ).toBe(true);
  });

  test("negate inverts the result", () => {
    expect(
      conditionMatches(
        cond({
          type: "title_regex",
          operator: "matches",
          value: "bluray",
          negate: true,
        }),
        ctx(),
      ),
    ).toBe(false);
  });

  test("invalid regex does not throw — returns false", () => {
    expect(
      conditionMatches(
        cond({ type: "title_regex", operator: "matches", value: "(" }),
        ctx(),
      ),
    ).toBe(false);
  });

  test("proper_repack is_true", () => {
    expect(
      conditionMatches(
        cond({ type: "proper_repack", operator: "is_true" }),
        ctx({ parsed: parsed({ isProper: true }) }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        cond({ type: "proper_repack", operator: "is_true" }),
        ctx(),
      ),
    ).toBe(false);
  });

  test("freeleech is_true", () => {
    expect(
      conditionMatches(
        cond({ type: "freeleech", operator: "is_true" }),
        ctx({ freeleech: true }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        cond({ type: "freeleech", operator: "is_true" }),
        ctx({ freeleech: false }),
      ),
    ).toBe(false);
  });

  test("resolution numeric compare with null guard", () => {
    expect(
      conditionMatches(
        cond({ type: "resolution", operator: "gte", value: 1080 }),
        ctx({ parsed: parsed({ resolution: 2160 }) }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        cond({ type: "resolution", operator: "gte", value: 1080 }),
        ctx({ parsed: parsed({ resolution: 720 }) }),
      ),
    ).toBe(false);
    expect(
      conditionMatches(
        cond({ type: "resolution", operator: "gte", value: 1080 }),
        ctx({ parsed: parsed({ resolution: null }) }),
      ),
    ).toBe(false);
  });

  test("negate inverts a non-match to true", () => {
    expect(
      conditionMatches(
        cond({
          type: "title_regex",
          operator: "matches",
          value: "doesnotexist",
          negate: true,
        }),
        ctx(),
      ),
    ).toBe(true);
  });

  test("between rejects malformed (non-numeric) bounds", () => {
    expect(
      conditionMatches(
        cond({
          type: "size_range",
          operator: "between",
          value: ["x", 10] as unknown as [number, number],
        }),
        ctx({ sizeBytes: 5_000_000_000 }),
      ),
    ).toBe(false);
  });
});

describe("formatMatches", () => {
  test("matches only when ALL conditions match", () => {
    const conditions: FormatCondition[] = [
      cond({ type: "source", operator: "equals", value: "BluRay" }),
      cond({ type: "seeders", operator: "gte", value: 10 }),
    ];
    expect(
      formatMatches(
        {
          name: "F",
          conditions,
          score: 100,
          required: false,
          forbidden: false,
        },
        ctx(),
      ),
    ).toBe(true);
    expect(
      formatMatches(
        {
          name: "F",
          conditions,
          score: 100,
          required: false,
          forbidden: false,
        },
        ctx({ seeders: 1 }),
      ),
    ).toBe(false);
  });

  test("empty conditions never matches (guards against an empty format scoring everything)", () => {
    expect(
      formatMatches(
        {
          name: "F",
          conditions: [],
          score: 100,
          required: false,
          forbidden: false,
        },
        ctx(),
      ),
    ).toBe(false);
  });
});
