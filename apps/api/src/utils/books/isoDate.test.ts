import { describe, expect, test } from "bun:test";
import { parseIsoDate } from "@rawkoon/api/utils/books/isoDate";

describe("parseIsoDate", () => {
  test("accepts a plain ISO date, anchored at midnight UTC", () => {
    expect(parseIsoDate("2024-06-27")?.toISOString()).toBe(
      "2024-06-27T00:00:00.000Z",
    );
  });

  test("accepts a full ISO instant and keeps the date part", () => {
    expect(parseIsoDate("2024-06-27T11:22:33.000Z")?.toISOString()).toBe(
      "2024-06-27T00:00:00.000Z",
    );
  });

  /**
   * The reason this exists: new Date("2024-02-30") is 1 March, so a typo would
   * be stored as a different publication date and reported as saved.
   */
  test("rejects a date that only exists after normalization", () => {
    expect(parseIsoDate("2024-02-30")).toBeNull();
    expect(parseIsoDate("2023-02-29")).toBeNull();
    expect(parseIsoDate("2024-13-01")).toBeNull();
    expect(parseIsoDate("2024-00-10")).toBeNull();
  });

  test("accepts a real leap day", () => {
    expect(parseIsoDate("2024-02-29")?.toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  /**
   * A permissive suffix is the same silent-acceptance bug in a new place: the
   * date parses, the trailing garbage is ignored, and the value is stored as
   * if it had been valid.
   */
  test("rejects garbage after a valid date", () => {
    expect(parseIsoDate("2024-06-27Tnot-a-date")).toBeNull();
    expect(parseIsoDate("2024-06-27 garbage")).toBeNull();
    expect(parseIsoDate("2024-06-27T")).toBeNull();
  });

  /**
   * Matching a timestamp's shape without its ranges is the same
   * silent-acceptance bug again: an impossible clock time parses, the time is
   * discarded, and the date is stored as if the input had been valid. An
   * earlier version of this suite asserted hour 25 was acceptable.
   */
  test("rejects impossible clock and offset values", () => {
    expect(parseIsoDate("2024-06-27T25:00:00Z")).toBeNull();
    expect(parseIsoDate("2024-06-27T12:99:00Z")).toBeNull();
    expect(parseIsoDate("2024-06-27T12:00:99Z")).toBeNull();
    expect(parseIsoDate("2024-06-27T12:00:00+99:99")).toBeNull();
    expect(parseIsoDate("2024-06-27T23:59:59Z")?.toISOString()).toBe(
      "2024-06-27T00:00:00.000Z",
    );
  });

  test("accepts the ISO time forms providers actually send", () => {
    for (const v of [
      "2024-06-27T00:00:00.000Z",
      "2024-06-27T11:22:33Z",
      "2024-06-27T11:22Z",
      "2024-06-27T11:22:33+02:00",
      "2024-06-27 11:22:33",
    ]) {
      expect(parseIsoDate(v)?.toISOString()).toBe("2024-06-27T00:00:00.000Z");
    }
  });

  test("rejects the loose forms new Date would have taken", () => {
    expect(parseIsoDate("0")).toBeNull();
    expect(parseIsoDate("03/04/2024")).toBeNull();
    expect(parseIsoDate("June 27, 2024")).toBeNull();
    expect(parseIsoDate("2024")).toBeNull();
    expect(parseIsoDate("2024-6-7")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
    expect(parseIsoDate("not-a-date")).toBeNull();
  });
});
