import { describe, expect, test } from "bun:test";
import { clientIpFromForwarded } from "./clientIp";

describe("clientIpFromForwarded", () => {
  test("returns the address the trusted proxy observed", () => {
    expect(clientIpFromForwarded("203.0.113.9, 198.51.100.4", 1)).toBe(
      "198.51.100.4",
    );
  });

  test("returns the client entry when two hops are trusted", () => {
    expect(clientIpFromForwarded("203.0.113.9, 198.51.100.4", 2)).toBe(
      "203.0.113.9",
    );
  });

  test("returns null when the header is absent", () => {
    expect(clientIpFromForwarded(undefined, 1)).toBeNull();
  });

  test("returns null when the header is empty", () => {
    expect(clientIpFromForwarded("", 1)).toBeNull();
    expect(clientIpFromForwarded("   ", 1)).toBeNull();
  });

  test("returns null when every entry is whitespace", () => {
    expect(clientIpFromForwarded(" , ,  ", 1)).toBeNull();
  });

  test("ignores empty entries around the real peer", () => {
    expect(clientIpFromForwarded("203.0.113.9, , 198.51.100.4", 1)).toBe(
      "198.51.100.4",
    );
  });

  test("returns null when fewer entries are present than hops trusted", () => {
    expect(clientIpFromForwarded("198.51.100.4", 2)).toBeNull();
    expect(clientIpFromForwarded("203.0.113.9, 198.51.100.4", 3)).toBeNull();
  });

  test("returns null when no hops are trusted", () => {
    expect(clientIpFromForwarded("198.51.100.4", 0)).toBeNull();
    expect(clientIpFromForwarded("198.51.100.4", -1)).toBeNull();
  });

  test("returns null for a non-numeric hop count", () => {
    expect(clientIpFromForwarded("198.51.100.4", Number.NaN)).toBeNull();
  });

  test("returns null when the selected entry is not an IP", () => {
    expect(clientIpFromForwarded("not-an-ip", 1)).toBeNull();
    expect(
      clientIpFromForwarded("198.51.100.4, evil-bucket-key", 1),
    ).toBeNull();
    expect(clientIpFromForwarded("999.0.0.1", 1)).toBeNull();
    expect(clientIpFromForwarded("192.0.2", 1)).toBeNull();
  });

  test("returns null for an IPv4 written with leading zeros", () => {
    // Two spellings of one address would otherwise be two rate-limit buckets.
    expect(clientIpFromForwarded("192.000.002.001", 1)).toBeNull();
  });

  test("strips a port from an IPv4 entry", () => {
    expect(clientIpFromForwarded("203.0.113.9:44321", 1)).toBe("203.0.113.9");
  });

  test("unwraps a bracketed IPv6 with a port", () => {
    expect(clientIpFromForwarded("[2001:DB8::1]:44321", 1)).toBe("2001:db8::1");
  });

  test("unwraps a bracketed IPv6 without a port", () => {
    expect(clientIpFromForwarded("[2001:db8::1]", 1)).toBe("2001:db8::1");
  });

  test("accepts compressed and full IPv6", () => {
    expect(clientIpFromForwarded("::1", 1)).toBe("::1");
    expect(clientIpFromForwarded("2001:DB8::1", 1)).toBe("2001:db8::1");
    expect(
      clientIpFromForwarded("2001:0db8:0000:0000:0000:0000:0000:0001", 1),
    ).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
  });

  test("accepts an IPv4-mapped IPv6 address", () => {
    expect(clientIpFromForwarded("::ffff:192.0.2.1", 1)).toBe(
      "::ffff:192.0.2.1",
    );
    expect(clientIpFromForwarded("[::FFFF:192.0.2.1]:443", 1)).toBe(
      "::ffff:192.0.2.1",
    );
  });

  test("rejects malformed IPv6", () => {
    expect(clientIpFromForwarded("1::2::3", 1)).toBeNull();
    expect(clientIpFromForwarded("2001:db8:::1", 1)).toBeNull();
    expect(clientIpFromForwarded("12345::1", 1)).toBeNull();
    expect(clientIpFromForwarded("[2001:db8::1", 1)).toBeNull();
    expect(clientIpFromForwarded("fe80::1%eth0", 1)).toBeNull();
  });

  test("selects the real peer despite many spoofed entries", () => {
    const header = [
      "9.9.9.9",
      "8.8.8.8",
      "7.7.7.7",
      "6.6.6.6",
      "203.0.113.9",
      "198.51.100.4",
    ].join(", ");
    expect(clientIpFromForwarded(header, 1)).toBe("198.51.100.4");
  });

  test("a spoofed header cannot shift the bucket key", () => {
    // The attacker varies everything they control; the trusted hop is fixed.
    const first = clientIpFromForwarded("1.1.1.1, 198.51.100.4", 1);
    const second = clientIpFromForwarded("2.2.2.2, 198.51.100.4", 1);
    expect(first).toBe("198.51.100.4");
    expect(second).toBe(first);
  });
});
