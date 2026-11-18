import { describe, expect, it } from "bun:test";
import {
  connectionFailure,
  describeError,
  endpointLabel,
  HttpStatusError,
} from "@rawkoon/api/utils/describeError";

const errno = (code: string) => Object.assign(new Error(code), { code });

describe("describeError", () => {
  it("classifies DNS failures", () => {
    expect(describeError(errno("ENOTFOUND"))).toContain("DNS lookup failed");
    expect(describeError(errno("EAI_AGAIN"))).toContain("DNS lookup failed");
  });

  it("classifies connection refused", () => {
    expect(describeError(errno("ECONNREFUSED"))).toContain(
      "connection refused",
    );
  });

  it("classifies timeouts by name, code, or message", () => {
    expect(
      describeError(
        Object.assign(new Error("The operation timed out."), {
          name: "TimeoutError",
        }),
      ),
    ).toBe("timed out");
    expect(describeError(errno("ETIMEDOUT"))).toBe("timed out");
    expect(describeError(new Error("probe timed out after 5000ms"))).toBe(
      "timed out",
    );
  });

  it("classifies TLS errors", () => {
    expect(describeError(errno("ERR_TLS_CERT_ALTNAME_INVALID"))).toContain(
      "TLS handshake failed",
    );
    expect(
      describeError(new Error("self-signed certificate in certificate chain")),
    ).toContain("TLS handshake failed");
  });

  it("classifies HTTP statuses, with 401/403 calling out the API key", () => {
    expect(describeError(new HttpStatusError(401))).toContain(
      "rejected the request (HTTP 401)",
    );
    expect(describeError(new HttpStatusError(403))).toContain(
      "the API key is likely invalid",
    );
    expect(describeError(new HttpStatusError(404))).toContain(
      "the base URL or path is wrong",
    );
    expect(describeError(new HttpStatusError(503))).toBe(
      "the server errored (HTTP 503)",
    );
    expect(describeError(new HttpStatusError(302))).toBe(
      "the server answered HTTP 302",
    );
  });

  it("walks the cause chain — fetch wraps the real error", () => {
    const wrapped = new TypeError("fetch failed", {
      cause: errno("ECONNREFUSED"),
    });
    expect(describeError(wrapped)).toContain("connection refused");
  });

  it("falls back to the message, redacting URL credentials", () => {
    const error = new Error(
      "connect ECONNREFUSED redis://admin:supersecret@redis.local:6379/0",
    );
    const described = describeError(error);
    expect(described).not.toContain("supersecret");
    expect(described).toContain("redis://redis.local:6379/…");
  });

  it("redacts query-string secrets in fallback messages, case-insensitively", () => {
    const cases = [
      "request to /3/configuration?api_key=SECRET123 failed",
      "request to /x?API_KEY=SECRET123&language=en failed",
      "request to /x?apikey=SECRET123&lang=en failed",
      "rejected (token=SECRET123)",
      "request to /x?access_token=SECRET123 failed",
    ];
    for (const message of cases) {
      expect(describeError(new Error(message))).not.toContain("SECRET123");
    }
  });

  it("keeps non-secret query params readable", () => {
    const described = describeError(
      new Error("GET /3/configuration?language=en&page=1 failed"),
    );
    expect(described).toContain("language=en&page=1");
  });

  it("truncates long fallback messages", () => {
    expect(describeError(new Error("x".repeat(500))).length).toBeLessThan(130);
  });
});

describe("endpointLabel", () => {
  it("returns host:port without credentials or paths", () => {
    expect(
      endpointLabel("https://user:secret@jellyfin.local:8096/System/Info"),
    ).toBe("jellyfin.local:8096");
  });

  it("is neutral when the URL cannot be parsed", () => {
    expect(endpointLabel("not a url")).toBe("the configured address");
  });
});

describe("connectionFailure", () => {
  it("returns a stable cause and names the target", () => {
    expect(connectionFailure(errno("ENOTFOUND"), "host:1")).toEqual({
      cause: "dns",
      message: expect.stringContaining("host:1"),
    });
    expect(connectionFailure(new Error("ntfy 401: nope"), "x").cause).toBe(
      "auth",
    );
    expect(connectionFailure(new Error("weird"), "x").cause).toBe("unknown");
  });
});

describe("secrets in URLs and over-eager classification", () => {
  it("drops the path, query and userinfo of any URL in free text", () => {
    const urls = [
      "https://discord.com/api/webhooks/123456/TOKENSECRET",
      "https://hooks.slack.com/services/T000/B000/SLACKSECRET",
      "https://ntfy.example.com/mytopic?auth=NTFYSECRET",
      "https://user:PASSSECRET@host.example/x",
    ];
    for (const url of urls) {
      const out = describeError(new Error(`Failed to parse URL from ${url}`));
      expect(out).not.toMatch(/SECRET|123456|mytopic|webhooks/);
      expect(out).toContain(`${new URL(url).host}/…`);
    }
  });

  it("does not invent a status from stray numbers", () => {
    expect(connectionFailure(new Error("Invalid 500 items"), "x").cause).toBe(
      "unknown",
    );
    const f = connectionFailure(new Error("Unexpected 404 in JSON"), "x");
    expect(f.cause).toBe("unknown");
    expect(f.message).not.toContain("HTTP");
  });

  it("classifies auth words neutrally, without a fabricated status", () => {
    const f = connectionFailure(
      new Error("Deluge login rejected: forbidden path"),
      "x",
    );
    expect(f.cause).toBe("auth");
    expect(f.message).toContain("the server rejected the credentials");
    expect(f.message).not.toMatch(/HTTP|API key/);
  });

  it("uses webhook wording for channel dispatch failures", () => {
    const f = connectionFailure(
      new Error("discord 401: nope"),
      "ch",
      "webhook",
    );
    expect(f.cause).toBe("auth");
    expect(f.message).toContain("webhook URL or token was rejected");
    expect(f.message).not.toContain("API key");
    expect(
      connectionFailure(new Error("slack 404: gone"), "ch", "webhook").message,
    ).toContain("webhook URL is wrong");
  });
});
