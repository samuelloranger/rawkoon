/**
 * Route tests for /api/custom-formats.
 *
 * Uses an in-memory stub prisma (not a real PrismaClient) so the suite is
 * fully isolated and never needs DATABASE_URL. Mirrors the downloadsScanner
 * pattern: top-level mock.module() + describe.serial().
 *
 * Auth is controlled by mocking @rawkoon/api/lib/auth (BetterAuth) and
 * prisma.user.findUnique — so the REAL requireUser middleware runs but
 * resolves to our injected fake user. This survives test/index.test.ts
 * pre-loading the entire app because mock.module updates live ESM bindings.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Elysia } from "elysia";

// ── In-memory stub state ──────────────────────────────────────────────────────

const EPOCH = new Date(0);

let nextId = 1;
let formatRows: Map<
  number,
  {
    id: number;
    name: string;
    conditions: unknown[];
    createdAt: Date;
    updatedAt: Date;
  }
> = new Map();
let simulateDuplicate = false;
let qualityProfileCustomFormatRows: {
  id: number;
  customFormatId: number;
  qualityProfileId: number;
}[] = [];

// ── Auth state ────────────────────────────────────────────────────────────────

type FakeUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean | null;
  locale: string | null;
  lastLogin: Date | null;
  createdAt: Date | null;
  lastActivity: Date | null;
  avatarUrl: string | null;
  navPosition: string | null;
} | null;

// The currently-injected user. Set to null to simulate unauthenticated.
let injectedDbUser: FakeUser = null;

// ── Prisma stub ───────────────────────────────────────────────────────────────

const prismaCfStub = {
  customFormat: {
    findMany: mock(async (args?: { orderBy?: { name?: string } }) => {
      const rows = [...formatRows.values()];
      if (args?.orderBy && "name" in args.orderBy) {
        const dir = args.orderBy.name === "asc" ? 1 : -1;
        rows.sort((a, b) => dir * a.name.localeCompare(b.name));
      }
      return rows;
    }),
    findUnique: mock(async (args: { where: { id: number } }) => {
      return formatRows.get(args.where.id) ?? null;
    }),
    create: mock(
      async (args: { data: { name: string; conditions: unknown } }) => {
        if (simulateDuplicate) {
          simulateDuplicate = false;
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        const id = nextId++;
        const row = {
          id,
          name: args.data.name,
          conditions: args.data.conditions as unknown[],
          createdAt: EPOCH,
          updatedAt: EPOCH,
        };
        formatRows.set(id, row);
        return row;
      },
    ),
    update: mock(
      async (args: {
        where: { id: number };
        data: { name: string; conditions: unknown };
      }) => {
        const row = formatRows.get(args.where.id);
        if (!row)
          throw Object.assign(new Error("Not found"), { code: "P2025" });
        const updated = {
          ...row,
          name: args.data.name,
          conditions: args.data.conditions as unknown[],
          updatedAt: new Date(),
        };
        formatRows.set(args.where.id, updated);
        return updated;
      },
    ),
    delete: mock(async (args: { where: { id: number } }) => {
      const row = formatRows.get(args.where.id);
      if (!row) throw Object.assign(new Error("Not found"), { code: "P2025" });
      formatRows.delete(args.where.id);
      return row;
    }),
  },
  qualityProfileCustomFormat: {
    count: mock(async (args?: { where?: { customFormatId?: number } }) => {
      const formatId = args?.where?.customFormatId;
      if (formatId === undefined) return 0;
      return qualityProfileCustomFormatRows.filter(
        (r) => r.customFormatId === formatId,
      ).length;
    }),
  },
  user: {
    findUnique: mock(async () => injectedDbUser),
  },
};

// ── Top-level mocks ───────────────────────────────────────────────────────────

mock.module("@rawkoon/api/db", () => ({ prisma: prismaCfStub }));

// Stub Better Auth so requireUser's resolveUser reads from injectedDbUser.
// auth.api.getSession returns a fake session when injectedDbUser is set, or
// null when it's null (→ 401). Uses a stable session user id "stub-user".
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        injectedDbUser ? { user: { id: injectedDbUser.id } } : null,
    },
    handler: async () => new Response("", { status: 404 }),
  },
}));

// Stub the Elysia Better Auth plugin (no-op for routes that mount it)
mock.module("@rawkoon/api/auth", () => ({
  auth: (app: Elysia) => app,
}));

// ── Lazy-import the route ─────────────────────────────────────────────────────

const { customFormatsRoutes } = await import("./index");

const app = new Elysia().use(customFormatsRoutes);

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_CONDITION = { type: "source", operator: "equals", value: "WEB-DL" };

const ADMIN_DB_USER: FakeUser = {
  id: "admin-id",
  email: "admin@test.local",
  firstName: "Admin",
  lastName: null,
  isAdmin: true,
  locale: null,
  lastLogin: null,
  createdAt: EPOCH,
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
};

const REGULAR_DB_USER: FakeUser = {
  id: "user-id",
  email: "user@test.local",
  firstName: "User",
  lastName: null,
  isAdmin: false,
  locale: null,
  lastLogin: null,
  createdAt: EPOCH,
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
};

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function jsonReq(path: string, method: string, body: unknown) {
  return req(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createFormat(name: string) {
  const res = await app.handle(
    jsonReq("/api/custom-formats", "POST", {
      name,
      conditions: [VALID_CONDITION],
    }),
  );
  return ((await res.json()) as any).custom_format as {
    id: number;
    name: string;
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.serial("Custom Formats API", () => {
  beforeEach(() => {
    injectedDbUser = ADMIN_DB_USER;
    nextId = 1;
    formatRows = new Map();
    simulateDuplicate = false;
    qualityProfileCustomFormatRows = [];
    prismaCfStub.customFormat.findMany.mockClear();
    prismaCfStub.customFormat.findUnique.mockClear();
    prismaCfStub.customFormat.create.mockClear();
    prismaCfStub.customFormat.update.mockClear();
    prismaCfStub.customFormat.delete.mockClear();
    prismaCfStub.qualityProfileCustomFormat.count.mockClear();
    prismaCfStub.user.findUnique.mockClear();
  });

  it("POST valid → 201 returns id and snake_case fields", async () => {
    const res = await app.handle(
      jsonReq("/api/custom-formats", "POST", {
        name: "WEB-DL",
        conditions: [VALID_CONDITION],
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(typeof body.custom_format.id).toBe("number");
    expect(body.custom_format.name).toBe("WEB-DL");
    expect(Array.isArray(body.custom_format.conditions)).toBe(true);
    expect(typeof body.custom_format.created_at).toBe("string");
    expect(typeof body.custom_format.updated_at).toBe("string");
  });

  it("GET / lists formats ordered by name asc", async () => {
    await createFormat("Zebra");
    await createFormat("Alpha");

    const res = await app.handle(req("/api/custom-formats"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.custom_formats)).toBe(true);
    expect(body.custom_formats.length).toBe(2);
    expect(body.custom_formats[0].name).toBe("Alpha");
    expect(body.custom_formats[1].name).toBe("Zebra");
  });

  it("PUT :id renames format → 200", async () => {
    const created = await createFormat("Original");

    const res = await app.handle(
      jsonReq(`/api/custom-formats/${created.id}`, "PUT", {
        name: "Renamed",
        conditions: [VALID_CONDITION],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.custom_format.name).toBe("Renamed");
  });

  it("DELETE :id → { deleted: true }", async () => {
    const created = await createFormat("ToDelete");

    const res = await app.handle(
      req(`/api/custom-formats/${created.id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.deleted).toBe(true);
  });

  it("DELETE returns 409 conflict when custom format is in use by a quality profile", async () => {
    const created = await createFormat("InUseFormat");
    qualityProfileCustomFormatRows.push({
      id: 1,
      customFormatId: created.id,
      qualityProfileId: 10,
    });

    const res = await app.handle(
      req(`/api/custom-formats/${created.id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe(
      "Cannot delete custom format while quality profiles are using it",
    );
  });

  it("POST with operator_invalid_for_type → 400 with code", async () => {
    const res = await app.handle(
      jsonReq("/api/custom-formats", "POST", {
        name: "Bad",
        conditions: [{ type: "source", operator: "matches", value: "x" }],
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("operator_invalid_for_type");
  });

  it("returns 401 when unauthenticated", async () => {
    injectedDbUser = null;
    const res = await app.handle(req("/api/custom-formats"));
    expect(res.status).toBe(401);
  });

  it("POST returns 403 when non-admin", async () => {
    injectedDbUser = REGULAR_DB_USER;
    const res = await app.handle(
      jsonReq("/api/custom-formats", "POST", {
        name: "Nope",
        conditions: [VALID_CONDITION],
      }),
    );
    expect(res.status).toBe(403);
  });

  it("PUT returns 403 when non-admin", async () => {
    const created = await createFormat("Guarded");
    injectedDbUser = REGULAR_DB_USER;
    const res = await app.handle(
      jsonReq(`/api/custom-formats/${created.id}`, "PUT", {
        name: "Renamed",
        conditions: [VALID_CONDITION],
      }),
    );
    expect(res.status).toBe(403);
  });

  it("DELETE returns 403 when non-admin", async () => {
    const created = await createFormat("GuardedDel");
    injectedDbUser = REGULAR_DB_USER;
    const res = await app.handle(
      req(`/api/custom-formats/${created.id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(403);
  });

  it("DELETE non-existent id → 404", async () => {
    const res = await app.handle(
      req("/api/custom-formats/999999", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });

  it("PUT with invalid conditions → 400 with code", async () => {
    const created = await createFormat("ToBreak");
    const res = await app.handle(
      jsonReq(`/api/custom-formats/${created.id}`, "PUT", {
        name: "ToBreak",
        conditions: [{ type: "source", operator: "matches", value: "x" }],
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("operator_invalid_for_type");
  });

  it("POST duplicate name → 409", async () => {
    await createFormat("Dup");
    simulateDuplicate = true;
    const res = await app.handle(
      jsonReq("/api/custom-formats", "POST", {
        name: "Dup",
        conditions: [VALID_CONDITION],
      }),
    );
    expect(res.status).toBe(409);
  });
});
