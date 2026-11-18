import { describe, expect, it, mock } from "bun:test";

// The confirm store is Valkey-backed; an in-memory stand-in keeps the
// single-use semantics visible in the test.
const store = new Map<string, string>();
mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async (k: string) => {
    const raw = store.get(k);
    return raw ? (JSON.parse(raw) as unknown) : null;
  },
  setJsonCache: async (k: string, v: unknown, ttl: number) => {
    store.set(k, JSON.stringify({ v, ttl }));
  },
  deleteCache: async (k: string) => {
    store.delete(k);
  },
  takeJsonCache: async (k: string) => {
    const raw = store.get(k);
    if (!raw) return null;
    store.delete(k);
    return JSON.parse(raw).v as unknown;
  },
  incrCache: async () => 1,
  ttlCache: async () => 42,
}));

const {
  canonicalJson,
  newConfirmToken,
  storeConfirmBinding,
  takeConfirmBinding,
} = await import("./confirm");

describe("canonicalJson", () => {
  it("is stable against key order and matches JSON for scalars", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(null)).toBe("null");
  });
});

describe("confirm tokens", () => {
  it("is a 128-bit hex token", () => {
    expect(newConfirmToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns the binding once, then nothing", async () => {
    const token = newConfirmToken();
    await storeConfirmBinding(token, {
      keyId: "k1",
      tool: "request_title",
      args: canonicalJson({ kind: "movie" }),
    });
    const first = await takeConfirmBinding(token);
    expect(first).toMatchObject({ keyId: "k1", tool: "request_title" });
    expect(await takeConfirmBinding(token)).toBeNull();
  });

  it("returns null for an unknown token", async () => {
    expect(await takeConfirmBinding("missing")).toBeNull();
  });
});
