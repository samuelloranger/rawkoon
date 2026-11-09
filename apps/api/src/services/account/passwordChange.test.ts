import { describe, expect, it, mock } from "bun:test";

const sessionDeleteMany = mock(async (_a: unknown) => ({ count: 0 }));
const prismaMock = {
  user: {
    findFirst: async () => ({ id: "u1", passwordHash: "hash" }),
    update: async () => ({}),
  },
  baAccount: { updateMany: async () => ({}) },
  baSession: { deleteMany: sessionDeleteMany },
  $transaction: async (ops: unknown[]) => Promise.all(ops),
};
mock.module("@rawkoon/api/db", () => ({ prisma: prismaMock }));
mock.module("@rawkoon/api/utils/password", () => ({
  hashPassword: async () => "new-hash",
  verifyPassword: async () => true,
}));

const { changeUserPassword } = await import("./passwordChange");

describe("changeUserPassword", () => {
  it("revokes other sessions but keeps the one making the change", async () => {
    await changeUserPassword("u1", "old", "new", "s1");
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { not: "s1" } },
    });
  });
});
