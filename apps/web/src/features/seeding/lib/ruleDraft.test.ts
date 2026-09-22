import { describe, expect, it } from "vitest";
import { draftFromRule, ruleFromDraft, ruleSentence } from "./ruleDraft";

const t = (key: string, opts?: Record<string, unknown>) =>
  `${key}${opts ? JSON.stringify(opts) : ""}`;

describe("rule drafts", () => {
  it("prefers days when the minutes divide evenly", () => {
    expect(draftFromRule({ ratio: 1, seed_time_mins: 4320 })).toEqual({
      ratio: "1",
      time: "3",
      unit: "days",
    });
    expect(draftFromRule({ ratio: null, seed_time_mins: 90 })).toEqual({
      ratio: "",
      time: "1.5",
      unit: "hours",
    });
  });
  it("parses empty fields as no target and rejects garbage", () => {
    expect(ruleFromDraft({ ratio: "", time: "", unit: "days" })).toEqual({
      ratio: null,
      seed_time_mins: null,
    });
    expect(ruleFromDraft({ ratio: "1.5", time: "2", unit: "days" })).toEqual({
      ratio: 1.5,
      seed_time_mins: 2880,
    });
    expect(ruleFromDraft({ ratio: "abc", time: "", unit: "days" })).toBeNull();
    expect(ruleFromDraft({ ratio: "-1", time: "", unit: "days" })).toBeNull();
  });
});

describe("ruleSentence", () => {
  it("covers all four combinations", () => {
    expect(ruleSentence({ ratio: 1, seed_time_mins: 4320 }, t)).toContain(
      "settings.seeding.sentence.both",
    );
    expect(ruleSentence({ ratio: 1, seed_time_mins: null }, t)).toContain(
      "settings.seeding.sentence.ratio",
    );
    expect(ruleSentence({ ratio: null, seed_time_mins: 60 }, t)).toContain(
      "settings.seeding.sentence.time",
    );
    expect(ruleSentence({ ratio: null, seed_time_mins: null }, t)).toBe(
      "settings.seeding.sentence.none",
    );
  });
});
