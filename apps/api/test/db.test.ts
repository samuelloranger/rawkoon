import { describe, expect, it } from "bun:test";
import { prisma } from "../src/db";

const hasDb = !!process.env.DATABASE_URL;

describe("Database Connection", () => {
  it("can query users table", async () => {
    if (!hasDb) return;
    const count = await prisma.user.count();
    console.log("User count:", count);
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
