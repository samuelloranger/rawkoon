import { describe, it, expect } from "bun:test";
import { isPrivateIP, safeFetch } from "../src/utils/ssrf";

describe("isPrivateIP", () => {
  it("detects private IPv4 ranges", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
    expect(isPrivateIP("10.0.0.1")).toBe(true);
    expect(isPrivateIP("172.16.31.254")).toBe(true);
    expect(isPrivateIP("172.32.0.1")).toBe(false);
    expect(isPrivateIP("192.168.1.100")).toBe(true);
    expect(isPrivateIP("169.254.169.254")).toBe(true);
    expect(isPrivateIP("0.0.0.0")).toBe(true);
    expect(isPrivateIP("8.8.8.8")).toBe(false);
    expect(isPrivateIP("1.1.1.1")).toBe(false);
  });

  it("detects the 100.64.0.0/10 CGNAT range", () => {
    expect(isPrivateIP("100.64.0.1")).toBe(true);
    expect(isPrivateIP("100.127.255.255")).toBe(true);
    expect(isPrivateIP("100.63.255.255")).toBe(false);
    expect(isPrivateIP("100.128.0.1")).toBe(false);
  });

  it("detects private IPv6 ranges", () => {
    expect(isPrivateIP("::1")).toBe(true);
    expect(isPrivateIP("::")).toBe(true);
    expect(isPrivateIP("fe80::1")).toBe(true);
    expect(isPrivateIP("fc00::1")).toBe(true);
    expect(isPrivateIP("2606:4700::1111")).toBe(false);
  });
});

describe("safeFetch", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(safeFetch("ftp://example.com")).rejects.toThrow(
      "Invalid protocol",
    );
  });

  it("blocks a direct private/local target IP before connecting", async () => {
    await expect(safeFetch("http://169.254.169.254/latest")).rejects.toThrow(
      "Outbound URL target IP is blocked",
    );
    await expect(safeFetch("http://127.0.0.1")).rejects.toThrow(
      "Outbound URL target IP is blocked",
    );
  });

  it("blocks hostnames that resolve to a private IP", async () => {
    await expect(safeFetch("http://localhost")).rejects.toThrow(
      "resolves to blocked IP",
    );
  });
});
