import { describe, it, expect } from "bun:test";
import { hashPassword, verifyPassword } from "@rawkoon/api/utils/password";

describe("hashPassword", () => {
  it("returns a string hash", async () => {
    const hash = await hashPassword("Test1234!");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("produces different hashes for the same password (salted)", async () => {
    const h1 = await hashPassword("Test1234!");
    const h2 = await hashPassword("Test1234!");
    expect(h1).not.toBe(h2);
  });

  it("produces an Argon2 hash by default", async () => {
    const hash = await hashPassword("Test1234!");
    expect(hash.startsWith("$argon2")).toBe(true);
  });
});

describe("verifyPassword", () => {
  describe("Argon2 (Bun native)", () => {
    it("returns true for correct password", async () => {
      const hash = await hashPassword("CorrectPassword1!");
      expect(await verifyPassword("CorrectPassword1!", hash)).toBe(true);
    });

    it("returns false for incorrect password", async () => {
      const hash = await hashPassword("CorrectPassword1!");
      expect(await verifyPassword("WrongPassword1!", hash)).toBe(false);
    });
  });

  describe("pbkdf2:sha256 (Werkzeug legacy)", () => {
    // Pre-computed Werkzeug pbkdf2 hash for "password123"
    // Format: pbkdf2:sha256:iterations$salt$hash
    it("verifies a valid pbkdf2 hash", async () => {
      const { pbkdf2Sync } = await import("node:crypto");
      const salt = "testsalt";
      const iterations = 260000;
      const derivedKey = pbkdf2Sync(
        "password123",
        salt,
        iterations,
        32,
        "sha256",
      );
      const hash = `pbkdf2:sha256:${iterations}$${salt}$${derivedKey.toString("hex")}`;

      expect(await verifyPassword("password123", hash)).toBe(true);
    });

    it("rejects wrong password for pbkdf2 hash", async () => {
      const { pbkdf2Sync } = await import("node:crypto");
      const salt = "testsalt";
      const iterations = 260000;
      const derivedKey = pbkdf2Sync(
        "password123",
        salt,
        iterations,
        32,
        "sha256",
      );
      const hash = `pbkdf2:sha256:${iterations}$${salt}$${derivedKey.toString("hex")}`;

      expect(await verifyPassword("wrongpassword", hash)).toBe(false);
    });

    it("returns false for malformed pbkdf2 hash (missing parts)", async () => {
      expect(await verifyPassword("test", "pbkdf2:sha256:260000$salt")).toBe(
        false,
      );
    });
  });

  describe("scrypt (Werkzeug legacy)", () => {
    it("verifies a valid scrypt hash", async () => {
      const { scryptSync } = await import("node:crypto");
      const salt = "testsalt";
      const n = 32768,
        r = 8,
        p = 1;
      const derivedKey = scryptSync("password123", salt, 64, {
        N: n,
        r,
        p,
        maxmem: 128 * 1024 * 1024,
      });
      const hash = `scrypt:${n}:${r}:${p}$${salt}$${derivedKey.toString("hex")}`;

      expect(await verifyPassword("password123", hash)).toBe(true);
    });

    it("rejects wrong password for scrypt hash", async () => {
      const { scryptSync } = await import("node:crypto");
      const salt = "testsalt";
      const n = 32768,
        r = 8,
        p = 1;
      const derivedKey = scryptSync("password123", salt, 64, {
        N: n,
        r,
        p,
        maxmem: 128 * 1024 * 1024,
      });
      const hash = `scrypt:${n}:${r}:${p}$${salt}$${derivedKey.toString("hex")}`;

      expect(await verifyPassword("wrongpassword", hash)).toBe(false);
    });

    it("returns false for malformed scrypt hash", async () => {
      expect(await verifyPassword("test", "scrypt:32768:8$salt$hash")).toBe(
        false,
      );
    });
  });

  describe("unknown formats", () => {
    it("returns false for unrecognized hash format", async () => {
      expect(await verifyPassword("test", "unknown$format$hash")).toBe(false);
    });

    it("returns false for empty hash", async () => {
      expect(await verifyPassword("test", "")).toBe(false);
    });
  });
});
