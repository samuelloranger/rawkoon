import { describe, expect, it } from "bun:test";
import { skippedOutcome, worstStatus } from "./status";

describe("worstStatus", () => {
  it("is ok when everything is ok (or nothing was checked)", () => {
    expect(worstStatus(["ok", "ok"])).toBe("ok");
    expect(worstStatus([])).toBe("ok");
  });

  it("lets a single warn beat any number of oks", () => {
    expect(worstStatus(["ok", "ok", "warn", "ok"])).toBe("warn");
  });

  it("lets fail beat warn and ok", () => {
    expect(worstStatus(["warn", "ok", "fail", "warn"])).toBe("fail");
  });

  it("keeps the worst across a realistic mix", () => {
    expect(worstStatus(["fail", "warn", "ok", "warn"])).toBe("fail");
    expect(worstStatus(["warn", "ok"])).toBe("warn");
  });
});

describe("skippedOutcome", () => {
  it("skips a db check with no fix when the database is down", () => {
    expect(skippedOutcome("db", { db: false, valkey: true })).toEqual({
      status: "fail",
      summary: "Skipped: the database is unreachable.",
      fix: null,
    });
  });

  it("skips a valkey check only when valkey is down", () => {
    expect(skippedOutcome("valkey", { db: true, valkey: false })?.summary).toBe(
      "Skipped: Valkey is unreachable.",
    );
    expect(skippedOutcome("valkey", { db: false, valkey: true })).toBeNull();
  });

  it("keeps the real error when the dependency is up, unknown or not needed", () => {
    expect(skippedOutcome("db", { db: true, valkey: true })).toBeNull();
    expect(skippedOutcome("db", null)).toBeNull();
    expect(skippedOutcome(undefined, { db: false, valkey: false })).toBeNull();
  });
});
