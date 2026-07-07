import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveToStorage,
  readFromStorage,
  deleteFromStorage,
} from "../src/services/storageService";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rawkoon-storage-"));
  process.env.IMAGE_STORAGE_DIR = dir;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.IMAGE_STORAGE_DIR;
});

describe("storageService", () => {
  it("saves, reads, and deletes a file", async () => {
    const buf = Buffer.from("hello");
    expect(await saveToStorage(buf, "a.txt")).toBe(true);

    const read = await readFromStorage("a.txt");
    expect(read?.toString()).toBe("hello");

    expect(await deleteFromStorage("a.txt")).toBe(true);
    expect(await readFromStorage("a.txt")).toBeNull();
  });

  it("returns null for missing files", async () => {
    expect(await readFromStorage("missing.txt")).toBeNull();
  });

  it("rejects path traversal attempts", async () => {
    await expect(saveToStorage(Buffer.from("x"), "../evil")).rejects.toThrow();
    await expect(readFromStorage("../evil")).rejects.toThrow();
    await expect(deleteFromStorage("../evil")).rejects.toThrow();
  });

  it("creates the storage dir on first write", async () => {
    await rm(dir, { recursive: true, force: true });
    expect(await saveToStorage(Buffer.from("x"), "a.txt")).toBe(true);
    expect((await readFromStorage("a.txt"))?.toString()).toBe("x");
  });
});
