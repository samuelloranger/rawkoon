import { describe, expect, it } from "bun:test";
import { worstStatus } from "./status";

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
