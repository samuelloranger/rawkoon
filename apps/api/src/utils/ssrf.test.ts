import { fakeDns } from "./testDnsMock";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { isBlockedForLanFetch, isPrivateIP, safeFetch } from "./ssrf";

// [address, blocked by strict policy, blocked by LAN policy]
const TABLE: [string, boolean, boolean][] = [
  ["127.0.0.1", true, true],
  ["0.0.0.0", true, true],
  ["::", true, true],
  ["::1", true, true],
  ["::127.0.0.1", true, true],
  ["::7f00:1", true, true],
  ["::a9fe:a9fe", true, true],
  ["::ffff:127.0.0.1", true, true],
  ["::ffff:7f00:1", true, true],
  ["64:ff9b::7f00:1", true, true],
  ["64:ff9b:1:7f00:0:100:808:808", true, true],
  ["64:ff9b:1:a9fe:a9:fe00:808:808", true, true],
  ["64:ff9b::808:808", false, false],
  ["2002:808:808::1", false, false],
  ["2002:7f00:1::", true, true],
  ["::ffff:169.254.169.254", true, true],
  ["169.254.169.254", true, true],
  ["fe80::1", true, true],
  ["ff02::1", true, true],
  ["224.0.0.1", true, true],
  ["240.0.0.1", true, true],
  ["255.255.255.255", true, true],
  ["198.18.0.1", true, true],
  ["192.0.0.1", true, true],
  ["fc00::1", true, false],
  ["100.64.0.1", true, false],
  ["192.168.1.10", true, false],
  ["10.0.0.5", true, false],
  ["172.20.0.3", true, false],
  ["::ffff:192.168.1.10", true, false],
  ["8.8.8.8", false, false],
  ["2606:4700::1111", false, false],
  ["not-an-ip", true, true],
  ["", true, true],
];

afterAll(() => fakeDns.clear());

describe("IP classifiers", () => {
  for (const [ip, strict, lan] of TABLE) {
    test(`${JSON.stringify(ip)} strict=${strict} lan=${lan}`, () => {
      expect(isPrivateIP(ip)).toBe(strict);
      expect(isBlockedForLanFetch(ip)).toBe(lan);
    });
  }
});

describe("safeFetch redirects", () => {
  const realFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit & { tls?: unknown } }[];
  let responses: Response[];

  const redirect = (status: number, location?: string) =>
    new Response(null, {
      status,
      headers: location ? { location } : undefined,
    });

  beforeEach(() => {
    calls = [];
    responses = [];
    fakeDns.set("a.test", ["8.8.8.8"]);
    fakeDns.set("b.test", ["1.1.1.1"]);
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return responses.shift() ?? new Response("ok");
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("rejects a redirect to loopback", async () => {
    responses = [redirect(302, "http://127.0.0.1/admin")];
    await expect(safeFetch("http://a.test/x")).rejects.toThrow("blocked");
    expect(calls).toHaveLength(1);
  });

  test("rejects a redirect to link-local metadata", async () => {
    responses = [redirect(302, "http://169.254.169.254/latest")];
    await expect(safeFetch("http://a.test/x")).rejects.toThrow("blocked");
  });

  test("rejects a redirect to a host resolving to a private IP", async () => {
    fakeDns.set("evil.test", ["10.0.0.5"]);
    responses = [redirect(302, "http://evil.test/")];
    await expect(safeFetch("http://a.test/x")).rejects.toThrow("blocked IP");
  });

  test("follows a redirect to another public host and re-pins it", async () => {
    responses = [redirect(302, "https://b.test/next")];
    const res = await safeFetch("http://a.test/x");
    expect(await res.text()).toBe("ok");
    expect(calls[0].url).toBe("http://8.8.8.8/x");
    expect((calls[0].init.headers as Headers).get("host")).toBe("a.test");
    expect(calls[1].url).toBe("https://1.1.1.1/next");
    expect((calls[1].init.headers as Headers).get("host")).toBe("b.test");
    expect((calls[1].init.tls as { serverName: string }).serverName).toBe(
      "b.test",
    );
    expect(calls[1].init.redirect).toBe("manual");
  });

  test("a caller cannot re-enable redirect following", async () => {
    await safeFetch("http://a.test/", { redirect: "follow" });
    expect(calls[0].init.redirect).toBe("manual");
  });

  test("303 after POST becomes GET without body or content headers", async () => {
    responses = [redirect(303, "/done")];
    await safeFetch("http://a.test/x", {
      method: "POST",
      body: "payload",
      headers: { "content-type": "text/plain", "content-length": "7" },
    });
    expect(calls[1].init.method).toBe("GET");
    expect(calls[1].init.body).toBeUndefined();
    const h = calls[1].init.headers as Headers;
    expect(h.has("content-type")).toBe(false);
    expect(h.has("content-length")).toBe(false);
  });

  test("302 after POST becomes GET", async () => {
    responses = [redirect(302, "/done")];
    await safeFetch("http://a.test/x", { method: "POST", body: "p" });
    expect(calls[1].init.method).toBe("GET");
    expect(calls[1].init.body).toBeUndefined();
  });

  test("307 keeps method and body", async () => {
    responses = [redirect(307, "/again")];
    await safeFetch("http://a.test/x", {
      method: "POST",
      body: "payload",
      headers: { "content-type": "text/plain" },
    });
    expect(calls[1].init.method).toBe("POST");
    expect(calls[1].init.body).toBe("payload");
    expect((calls[1].init.headers as Headers).get("content-type")).toBe(
      "text/plain",
    );
  });

  test("throws after more than 5 redirects", async () => {
    responses = Array.from({ length: 10 }, () => redirect(302, "/loop"));
    await expect(safeFetch("http://a.test/x")).rejects.toThrow(
      "Too many redirects",
    );
    expect(calls).toHaveLength(6);
  });

  test("allows exactly 5 redirects", async () => {
    responses = Array.from({ length: 5 }, () => redirect(302, "/loop"));
    const res = await safeFetch("http://a.test/x");
    expect(res.status).toBe(200);
  });

  test("cross-origin hop keeps only credential-free headers", async () => {
    responses = [redirect(302, "/same"), redirect(302, "http://b.test/other")];
    await safeFetch("http://a.test/x", {
      headers: {
        authorization: "Bearer t",
        cookie: "s=1",
        "x-api-key": "k",
        "user-agent": "rawkoon",
      },
    });
    const same = calls[1].init.headers as Headers;
    expect(same.get("authorization")).toBe("Bearer t");
    expect(same.get("x-api-key")).toBe("k");
    const cross = calls[2].init.headers as Headers;
    expect(cross.has("authorization")).toBe(false);
    expect(cross.has("cookie")).toBe(false);
    expect(cross.has("x-api-key")).toBe(false);
    expect(cross.get("user-agent")).toBe("rawkoon");
  });

  test("an http→https upgrade on the same host keeps credentials", async () => {
    responses = [redirect(301, "https://a.test/x")];
    await safeFetch("http://a.test/x", { headers: { "x-api-key": "k" } });
    expect((calls[1].init.headers as Headers).get("x-api-key")).toBe("k");
  });

  test("dials IPv4 first and falls back to the next address on a network error", async () => {
    fakeDns.set("dual.test", ["2606:4700::1111", "8.8.4.4", "1.0.0.1"]);
    let failFirst = true;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (failFirst) {
        failFirst = false;
        throw new TypeError("connect ECONNREFUSED");
      }
      return new Response("ok");
    }) as unknown as typeof fetch;
    const res = await safeFetch("http://dual.test/x");
    expect(await res.text()).toBe("ok");
    expect(calls.map((c) => c.url)).toEqual([
      "http://8.8.4.4/x",
      "http://1.0.0.1/x",
    ]);
  });

  test("does not try other addresses once the request is aborted", async () => {
    fakeDns.set("dual.test", ["8.8.4.4", "1.0.0.1"]);
    const ctrl = new AbortController();
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      ctrl.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(
      safeFetch("http://dual.test/x", { signal: ctrl.signal }),
    ).rejects.toThrow("aborted");
    expect(calls).toHaveLength(1);
  });

  test("a 3xx without Location is returned as the final response", async () => {
    responses = [redirect(304)];
    const res = await safeFetch("http://a.test/x");
    expect(res.status).toBe(304);
    expect(calls).toHaveLength(1);
  });

  test("rejects a redirect to a non-http protocol", async () => {
    responses = [redirect(302, "file:///etc/passwd")];
    await expect(safeFetch("http://a.test/x")).rejects.toThrow(
      "Invalid protocol",
    );
  });
});
