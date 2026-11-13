import { describe, expect, it } from "vitest";
import { CHRISTMAS_WINDOW, daysInMonth, toMonthDay } from "./monthDay";

describe("toMonthDay", () => {
  it("is empty only when both parts are", () => {
    expect(toMonthDay("", "")).toBeNull();
    expect(toMonthDay("", "15")).toBe("01-15");
    expect(toMonthDay("03", "")).toBe("03-01");
  });

  it("clamps the day when the month shrinks", () => {
    expect(toMonthDay("02", "31")).toBe("02-29");
    expect(toMonthDay("04", "31")).toBe("04-30");
    expect(toMonthDay("12", "31")).toBe("12-31");
  });

  it("leaves the Christmas preset untouched", () => {
    for (const value of Object.values(CHRISTMAS_WINDOW)) {
      expect(toMonthDay(value.slice(0, 2), value.slice(3, 5))).toBe(value);
    }
    expect(CHRISTMAS_WINDOW).toEqual({ from: "11-01", to: "01-15" });
  });
});

describe("daysInMonth", () => {
  it("knows short months", () => {
    expect(daysInMonth("02")).toBe(29);
    expect(["04", "06", "09", "11"].map(daysInMonth)).toEqual([30, 30, 30, 30]);
    expect(daysInMonth("01")).toBe(31);
  });
});
