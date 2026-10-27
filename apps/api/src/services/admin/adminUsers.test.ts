import { beforeEach, describe, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;
const userFindFirst = mock(async (_a: unknown): Promise<Row | null> => null);
const userCount = mock(async (_a: unknown) => 0);
const userUpdate = mock(async (a: { data: Row }) => ({ id: "u1", ...a.data }));
const userDeleteMany = mock(async (_a: unknown) => ({ count: 1 }));
const invitationFindFirst = mock(
  async (_a: unknown): Promise<Row | null> => null,
);
const invitationUpdateMany = mock(async (_a: unknown) => ({ count: 1 }));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: {
      findFirst: userFindFirst,
      count: userCount,
      update: userUpdate,
      deleteMany: userDeleteMany,
    },
    invitation: {
      findFirst: invitationFindFirst,
      updateMany: invitationUpdateMany,
    },
  },
}));

const { setUserRole, deleteUser } = await import("./adminUsers");
const { regenerateInvitation, revokeInvitation } = await import(
  "./adminInvitations"
);

beforeEach(() => {
  for (const m of [
    userFindFirst,
    userCount,
    userUpdate,
    userDeleteMany,
    invitationFindFirst,
    invitationUpdateMany,
  ]) {
    m.mockClear();
  }
  userFindFirst.mockImplementation(async () => null);
  userCount.mockImplementation(async () => 0);
  userDeleteMany.mockImplementation(async () => ({ count: 1 }));
  invitationFindFirst.mockImplementation(async () => null);
  invitationUpdateMany.mockImplementation(async () => ({ count: 1 }));
});

describe("setUserRole", () => {
  it("reports a missing user", async () => {
    expect(await setUserRole("u1", true)).toEqual({ kind: "not_found" });
  });

  it("refuses to demote the last admin", async () => {
    userFindFirst.mockImplementation(async () => ({ id: "u1", isAdmin: true }));
    expect(await setUserRole("u1", false)).toEqual({ kind: "last_admin" });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("demotes an admin when another one remains", async () => {
    userFindFirst.mockImplementation(async () => ({ id: "u1", isAdmin: true }));
    userCount.mockImplementation(async () => 1);
    const result = await setUserRole("u1", false);
    expect(result.kind).toBe("updated");
  });
});

describe("deleteUser", () => {
  it("reports not_found when the row vanished before the delete", async () => {
    userFindFirst.mockImplementation(async () => ({
      id: "u1",
      email: "a@b.c",
    }));
    userDeleteMany.mockImplementation(async () => ({ count: 0 }));
    expect(await deleteUser("u1")).toEqual({ kind: "not_found" });
  });

  it("returns the deleted email", async () => {
    userFindFirst.mockImplementation(async () => ({
      id: "u1",
      email: "a@b.c",
    }));
    expect(await deleteUser("u1")).toEqual({ kind: "deleted", email: "a@b.c" });
  });
});

describe("invitation state changes", () => {
  it("rejects non-pending invitations", async () => {
    invitationFindFirst.mockImplementation(async () => ({ status: "revoked" }));
    expect(await regenerateInvitation(1)).toEqual({ kind: "not_pending" });
    expect(await revokeInvitation(1)).toEqual({ kind: "not_pending" });
  });

  it("reports a lost race on the guarded update", async () => {
    invitationFindFirst.mockImplementation(async () => ({ status: "pending" }));
    invitationUpdateMany.mockImplementation(async () => ({ count: 0 }));
    expect(await regenerateInvitation(1)).toEqual({ kind: "raced" });
    expect(await revokeInvitation(1)).toEqual({ kind: "raced" });
  });

  it("returns a fresh token on regenerate", async () => {
    invitationFindFirst.mockImplementation(async () => ({ status: "pending" }));
    const result = await regenerateInvitation(1);
    expect(result.kind).toBe("ok");
  });
});
