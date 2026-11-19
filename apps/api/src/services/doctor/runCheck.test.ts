import { describe, expect, it } from "bun:test";
import { runCheck, type CheckDef } from "./runCheck";

const base = {
  id: "x",
  title: "X",
  fixOnCrash: "Fix it.",
} satisfies Partial<CheckDef>;

const boom: CheckDef["run"] = async () => {
  throw new Error("boom");
};
const health = (db: boolean) =>
  Promise.resolve({ status: "ok" as const, db, valkey: true });

describe("runCheck", () => {
  it("turns a hanging probe into a timed-out failure", async () => {
    const [check] = await runCheck(
      { ...base, timeoutMs: 10, run: () => new Promise(() => {}) },
      health(true),
    );
    expect(check.status).toBe("fail");
    expect(check.summary).toContain("timed out");
  });

  it("keeps the real error and fix when the dependency is up", async () => {
    const [check] = await runCheck(
      { ...base, needs: "db", run: boom },
      health(true),
    );
    expect(check.summary).toContain("Could not be checked");
    expect(check.fix).toBe("Fix it.");
  });

  it("skips with no fix when the dependency is down", async () => {
    const [check] = await runCheck(
      { ...base, needs: "db", run: boom },
      health(false),
    );
    expect(check.status).toBe("fail");
    expect(check.summary).toBe("Skipped: the database is unreachable.");
    expect(check.fix).toBeNull();
  });

  it("keeps the real error when the health probe itself produced nothing", async () => {
    const [check] = await runCheck(
      { ...base, needs: "db", run: boom },
      Promise.resolve(null),
    );
    expect(check.summary).toContain("Could not be checked");
    expect(check.fix).toBe("Fix it.");
  });
});
