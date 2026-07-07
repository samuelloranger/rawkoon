import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  setSystemTime,
} from "bun:test";
import { isNightTime } from "./date";

const originalTz = Bun.env.TZ;

beforeAll(() => {
  Bun.env.TZ = "UTC";
});

afterAll(() => {
  setSystemTime(); // restore the real clock
  if (originalTz === undefined) delete Bun.env.TZ;
  else Bun.env.TZ = originalTz;
});

function at(iso: string) {
  setSystemTime(new Date(iso));
}

describe("isNightTime (quiet hours 23h–6h)", () => {
  it("is night at 02:00", () => {
    at("2026-05-31T02:00:00Z");
    expect(isNightTime()).toBe(true);
  });

  it("is night at 23:30 (lower boundary)", () => {
    at("2026-05-31T23:30:00Z");
    expect(isNightTime()).toBe(true);
  });

  it("is night at 05:59 (just before the window ends)", () => {
    at("2026-05-31T05:59:00Z");
    expect(isNightTime()).toBe(true);
  });

  it("is day at 06:00 (window ends)", () => {
    at("2026-05-31T06:00:00Z");
    expect(isNightTime()).toBe(false);
  });

  it("is day at 14:00", () => {
    at("2026-05-31T14:00:00Z");
    expect(isNightTime()).toBe(false);
  });

  it("is day at 22:59 (just before the window starts)", () => {
    at("2026-05-31T22:59:00Z");
    expect(isNightTime()).toBe(false);
  });
});
