import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { infoHashFromTorrentBuffer } from "@rawkoon/api/services/mediaGrabberHelpers";

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const toAB = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

// Binary, non-UTF8 piece hashes.
const pieces = new Uint8Array([0xff, 0x00, 0xfe, 0x80, 0x01, 0xc3, 0x28, 0xa0]);

// Hand-assembled canonical info dict (keys sorted).
const infoBytes = concat(
  enc("d6:lengthi12345e4:name8:test.mkv12:piece lengthi16384e6:pieces8:"),
  pieces,
  enc("e"),
);
const expectedHash = createHash("sha1").update(infoBytes).digest("hex");

const torrent = (head = "") =>
  concat(enc(`d${head}4:info`), infoBytes, enc("e"));

describe("infoHashFromTorrentBuffer", () => {
  test("hashes the exact info dict bytes, binary pieces included", () => {
    expect(infoHashFromTorrentBuffer(toAB(torrent()))).toBe(expectedHash);
  });

  test("returns null quickly on a truncated buffer", () => {
    const full = torrent("8:announce20:http://tracker/x/ann");
    const start = performance.now();
    for (const cut of [full.length >> 1, full.length - 3, 5]) {
      expect(infoHashFromTorrentBuffer(toAB(full.slice(0, cut)))).toBeNull();
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("ignores a 4:info sequence inside string values", () => {
    const str = (v: string) => `${v.length}:${v}`;
    const buf = torrent(
      `8:announce${str("http://x/4:infoannounce")}7:comment${str("see 4:info!")}`,
    );
    expect(infoHashFromTorrentBuffer(toAB(buf))).toBe(expectedHash);
  });

  test("returns null for non-dict top level, missing or non-dict info", () => {
    expect(infoHashFromTorrentBuffer(toAB(enc("le")))).toBeNull();
    expect(infoHashFromTorrentBuffer(toAB(enc("i42e")))).toBeNull();
    expect(infoHashFromTorrentBuffer(toAB(enc("4:spam")))).toBeNull();
    expect(
      infoHashFromTorrentBuffer(toAB(enc("d8:announce3:urle"))),
    ).toBeNull();
    expect(infoHashFromTorrentBuffer(toAB(enc("d4:info3:abce")))).toBeNull();
    expect(infoHashFromTorrentBuffer(toAB(enc("d4:infolee")))).toBeNull();
  });

  test("hashes the raw info bytes even when keys are unsorted", () => {
    const rawInfo = "d4:name1:a6:lengthi1ee";
    const buf = enc(`d4:info${rawInfo}e`);
    const expected = createHash("sha1").update(enc(rawInfo)).digest("hex");
    expect(infoHashFromTorrentBuffer(toAB(buf))).toBe(expected);
  });

  test("hashes the top-level info, not a copy quoted in a later string", () => {
    const rawInfo = "d4:name1:a6:lengthi1ee";
    const quoted = "see 4:infod6:lengthi1e4:name1:aee";
    const buf = enc(`d4:info${rawInfo}7:comment${quoted.length}:${quoted}e`);
    const expected = createHash("sha1").update(enc(rawInfo)).digest("hex");
    expect(infoHashFromTorrentBuffer(toAB(buf))).toBe(expected);
  });

  test("returns null quickly on malformed lengths and nesting", () => {
    const start = performance.now();
    for (const input of [
      "d4:infod1:a-3:xxee",
      "d4:spami1e-3:abce",
      "d4:info999999999999:xe",
      "d4:infod1:ai-ee",
      "d4:infod1:aiee",
      `d4:info${"l".repeat(200)}${"e".repeat(200)}e`,
    ]) {
      expect(infoHashFromTorrentBuffer(toAB(enc(input)))).toBeNull();
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("ignores an info key reached only through __proto__", () => {
    const buf = enc("d9:__proto__d4:infod6:lengthi1e4:name1:aeee");
    expect(infoHashFromTorrentBuffer(toAB(buf))).toBeNull();
  });

  test("returns null for an empty buffer", () => {
    expect(infoHashFromTorrentBuffer(new ArrayBuffer(0))).toBeNull();
  });
});
