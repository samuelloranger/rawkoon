import { describe, expect, test } from "bun:test";
import {
  buildApnsPayload,
  classifyApnsStatus,
  MAX_APNS_PAYLOAD_BYTES,
  type PushRequest,
  pushRequestSchema,
} from "./payload";

const TOKEN = "a".repeat(64);

function baseRequest(overrides: Partial<PushRequest> = {}): PushRequest {
  return {
    token: TOKEN,
    title: "Downloaded",
    body: "Dune (2021) is ready to watch",
    ...overrides,
  };
}

function payloadBytes(req: PushRequest): number {
  return Buffer.byteLength(JSON.stringify(buildApnsPayload(req)), "utf8");
}

// Pads `data.pad` so the serialized payload lands on exactly `target` bytes.
function requestOfSize(target: number, fill = "a"): PushRequest {
  const bytesPerChar = Buffer.byteLength(fill, "utf8");
  const overhead = payloadBytes(baseRequest({ data: { pad: "" } }));
  const count = Math.floor((target - overhead) / bytesPerChar);
  return baseRequest({ data: { pad: fill.repeat(count) } });
}

describe("buildApnsPayload", () => {
  test("keeps the relay-built aps and the real title/body", () => {
    const payload = buildApnsPayload(baseRequest());
    expect(payload).toEqual({
      aps: {
        alert: { title: "Downloaded", body: "Dune (2021) is ready to watch" },
        sound: "default",
      },
    });
  });

  test("discards a caller-supplied aps", () => {
    const payload = buildApnsPayload(
      baseRequest({
        data: {
          aps: {
            alert: { title: "Bank of America", body: "Confirm your login" },
            "content-available": 1,
            "mutable-content": 1,
            badge: 99,
            category: "HIJACK",
            sound: "hijack.caf",
          },
        },
      }),
    );
    expect(payload.aps).toEqual({
      alert: { title: "Downloaded", body: "Dune (2021) is ready to watch" },
      sound: "default",
    });
    const aps = payload.aps as Record<string, unknown>;
    expect(aps["content-available"]).toBeUndefined();
    expect(aps["mutable-content"]).toBeUndefined();
    expect(aps.badge).toBeUndefined();
    expect(aps.category).toBeUndefined();
  });

  test("a caller aps cannot bypass the title/body caps", () => {
    const payload = buildApnsPayload(
      baseRequest({
        data: {
          aps: { alert: { title: "x".repeat(500), body: "y".repeat(5000) } },
        },
      }),
    );
    const alert = (payload.aps as { alert: { title: string; body: string } })
      .alert;
    expect(alert.title).toBe("Downloaded");
    expect(alert.body.length).toBeLessThanOrEqual(400);
  });

  test.each([
    ["string", "wide open"],
    ["null", null],
    ["array", [{ "content-available": 1 }]],
    ["number", 1],
    ["boolean", true],
    ["nested", { alert: { aps: { "content-available": 1 } } }],
  ])("a hostile aps of type %s neither crashes nor leaks", (_label, aps) => {
    const payload = buildApnsPayload(baseRequest({ data: { aps } }));
    expect(payload.aps).toEqual({
      alert: { title: "Downloaded", body: "Dune (2021) is ready to watch" },
      sound: "default",
    });
    expect(JSON.stringify(payload)).not.toContain("content-available");
  });

  test("custom data keys still reach the payload", () => {
    const payload = buildApnsPayload(
      baseRequest({
        data: {
          deepLink: "rawkoon://library/42",
          mediaId: 42,
          nested: { season: 1, episodes: [1, 2] },
          aps: { badge: 7 },
        },
      }),
    );
    expect(payload.deepLink).toBe("rawkoon://library/42");
    expect(payload.mediaId).toBe(42);
    expect(payload.nested).toEqual({ season: 1, episodes: [1, 2] });
    expect(payload.aps).toEqual({
      alert: { title: "Downloaded", body: "Dune (2021) is ready to watch" },
      sound: "default",
    });
  });

  test("a custom key named like an aps field stays at top level", () => {
    const payload = buildApnsPayload(
      baseRequest({ data: { "content-available": 1, sound: "chime.caf" } }),
    );
    expect(payload["content-available"]).toBe(1);
    expect((payload.aps as { sound: string }).sound).toBe("default");
  });

  test("does not mutate the caller's data object", () => {
    const data = { aps: { badge: 1 }, mediaId: 7 };
    buildApnsPayload(baseRequest({ data }));
    expect(data.aps).toEqual({ badge: 1 });
  });

  test("collapseId is request metadata, not payload content", () => {
    const payload = buildApnsPayload(baseRequest({ collapseId: "media-42" }));
    expect(payload.collapseId).toBeUndefined();
  });
});

describe("pushRequestSchema", () => {
  test("accepts a minimal valid request", () => {
    const parsed = pushRequestSchema.safeParse({
      token: TOKEN,
      title: "Downloaded",
      body: "Ready to watch",
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts a full request and keeps collapseId and data", () => {
    const parsed = pushRequestSchema.safeParse({
      token: TOKEN,
      title: "Downloaded",
      body: "Ready to watch",
      collapseId: "media-42",
      data: { deepLink: "rawkoon://library/42" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.collapseId).toBe("media-42");
    expect(parsed.data.data).toEqual({ deepLink: "rawkoon://library/42" });
  });

  test.each([
    ["a non-hex token", { token: `z${"a".repeat(63)}` }],
    ["a short token", { token: "abc" }],
    ["an empty title", { title: "" }],
    ["an over-long title", { title: "x".repeat(121) }],
    ["an empty body", { body: "" }],
    ["an over-long body", { body: "x".repeat(401) }],
  ])("rejects %s", (_label, override) => {
    const parsed = pushRequestSchema.safeParse({
      token: TOKEN,
      title: "Downloaded",
      body: "Ready to watch",
      ...override,
    });
    expect(parsed.success).toBe(false);
  });

  test("the APNs alert limit is 4 KiB", () => {
    expect(MAX_APNS_PAYLOAD_BYTES).toBe(4096);
  });

  test("accepts a payload that lands exactly on the limit", () => {
    const req = requestOfSize(MAX_APNS_PAYLOAD_BYTES);
    expect(payloadBytes(req)).toBe(MAX_APNS_PAYLOAD_BYTES);
    expect(pushRequestSchema.safeParse(req).success).toBe(true);
  });

  test("rejects a payload one byte over the limit", () => {
    const req = requestOfSize(MAX_APNS_PAYLOAD_BYTES + 1);
    expect(payloadBytes(req)).toBe(MAX_APNS_PAYLOAD_BYTES + 1);
    const parsed = pushRequestSchema.safeParse(req);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain("4096");
  });

  test("rejects a grossly oversized data", () => {
    const parsed = pushRequestSchema.safeParse(
      baseRequest({ data: { pad: "a".repeat(7000) } }),
    );
    expect(parsed.success).toBe(false);
  });

  test("measures multi-byte characters in bytes, not string length", () => {
    // Under 4096 characters, over 4096 UTF-8 bytes.
    const req = baseRequest({ data: { pad: "é".repeat(2200) } });
    const pad = (req.data as { pad: string }).pad;
    expect(pad.length).toBeLessThan(MAX_APNS_PAYLOAD_BYTES);
    expect(payloadBytes(req)).toBeGreaterThan(MAX_APNS_PAYLOAD_BYTES);
    expect(pushRequestSchema.safeParse(req).success).toBe(false);
  });

  test("measures astral-plane characters in bytes, not code units", () => {
    const req = baseRequest({ data: { pad: "🎬".repeat(1100) } });
    const pad = (req.data as { pad: string }).pad;
    expect(pad.length).toBeLessThan(MAX_APNS_PAYLOAD_BYTES);
    expect(payloadBytes(req)).toBeGreaterThan(MAX_APNS_PAYLOAD_BYTES);
    expect(pushRequestSchema.safeParse(req).success).toBe(false);
  });

  test("measures the payload sent to Apple, not the request body", () => {
    // The discarded aps is huge but never sent, so the request stays valid.
    const parsed = pushRequestSchema.safeParse(
      baseRequest({ data: { aps: { pad: "a".repeat(6000) } } }),
    );
    expect(parsed.success).toBe(true);
  });

  test("a multi-byte title counts toward the limit", () => {
    const req = requestOfSize(MAX_APNS_PAYLOAD_BYTES, "é");
    const withLongTitle = { ...req, title: "é".repeat(120) };
    expect(payloadBytes(withLongTitle)).toBeGreaterThan(MAX_APNS_PAYLOAD_BYTES);
    expect(pushRequestSchema.safeParse(withLongTitle).success).toBe(false);
  });
});

describe("classifyApnsStatus", () => {
  test.each<[number, ReturnType<typeof classifyApnsStatus>]>([
    [200, "ok"],
    [410, "unregistered"],
    [429, "retry"],
    [500, "retry"],
    [503, "retry"],
    [400, "rejected"],
    [403, "rejected"],
    [404, "rejected"],
    [413, "rejected"],
  ])("maps %i to %s", (status, expected) => {
    expect(classifyApnsStatus(status)).toBe(expected);
  });
});
