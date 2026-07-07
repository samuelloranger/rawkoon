/**
 * Route tests for /api/quality-profiles.
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

let nextProfileId = 1;
let nextFormatId = 100;

type CfRow = {
  id: number;
  name: string;
  conditions: unknown[];
  createdAt: Date;
  updatedAt: Date;
};

type AssignmentRow = {
  qualityProfileId: number;
  customFormatId: number;
  score: number;
  required: boolean;
  forbidden: boolean;
};

type ProfileRow = {
  id: number;
  name: string;
  minResolution: number;
  preferredSources: string[];
  preferredCodecs: string[];
  preferredLanguages: string[];
  prioritizedTrackers: string[];
  preferTrackerOverQuality: boolean;
  maxSizeGb: number | null;
  requireHdr: boolean;
  preferHdr: boolean;
  cutoffResolution: number | null;
  minSeeders: number;
  createdAt: Date;
  updatedAt: Date;
};

let profileRows: Map<number, ProfileRow> = new Map();
let assignmentRows: AssignmentRow[] = [];
let formatRows: Map<number, CfRow> = new Map();

let simulateProfileDuplicate = false;
let simulateFkError = false;

// ── Auth state ────────────────────────────────────────────────────────────────

type FakeDbUser = {
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

let injectedDbUser: FakeDbUser = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildProfileWithFormats(profile: ProfileRow) {
  const assignments = assignmentRows.filter(
    (a) => a.qualityProfileId === profile.id,
  );
  return {
    ...profile,
    customFormats: assignments.map((a) => ({
      qualityProfileId: a.qualityProfileId,
      customFormatId: a.customFormatId,
      score: a.score,
      required: a.required,
      forbidden: a.forbidden,
      customFormat: formatRows.get(a.customFormatId) ?? {
        id: a.customFormatId,
        name: "Unknown",
        conditions: [],
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    })),
  };
}

function buildTxStub() {
  return {
    qualityProfile: {
      create: async (args: {
        data: Omit<ProfileRow, "id" | "createdAt" | "updatedAt">;
      }) => {
        if (simulateProfileDuplicate) {
          simulateProfileDuplicate = false;
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        const id = nextProfileId++;
        const row: ProfileRow = {
          id,
          name: args.data.name,
          minResolution: args.data.minResolution,
          preferredSources: args.data.preferredSources,
          preferredCodecs: args.data.preferredCodecs,
          preferredLanguages: args.data.preferredLanguages,
          prioritizedTrackers: args.data.prioritizedTrackers,
          preferTrackerOverQuality: args.data.preferTrackerOverQuality,
          maxSizeGb: args.data.maxSizeGb,
          requireHdr: args.data.requireHdr,
          preferHdr: args.data.preferHdr,
          cutoffResolution: args.data.cutoffResolution,
          minSeeders: args.data.minSeeders,
          createdAt: EPOCH,
          updatedAt: EPOCH,
        };
        profileRows.set(id, row);
        return row;
      },
      findUnique: async (args: { where: { id: number } }) => {
        return profileRows.get(args.where.id) ?? null;
      },
      findUniqueOrThrow: async (args: {
        where: { id: number };
        include?: unknown;
      }) => {
        const row = profileRows.get(args.where.id);
        if (!row)
          throw Object.assign(new Error("Not found"), { code: "P2025" });
        return buildProfileWithFormats(row);
      },
      update: async (args: {
        where: { id: number };
        data: Partial<ProfileRow>;
      }) => {
        const row = profileRows.get(args.where.id);
        if (!row)
          throw Object.assign(new Error("Not found"), { code: "P2025" });
        const updated = { ...row, ...args.data, updatedAt: new Date() };
        profileRows.set(args.where.id, updated);
        return updated;
      },
    },
    qualityProfileCustomFormat: {
      createMany: async (args: { data: AssignmentRow[] }) => {
        if (simulateFkError) {
          simulateFkError = false;
          throw Object.assign(new Error("FK constraint failed"), {
            code: "P2003",
          });
        }
        for (const a of args.data) {
          assignmentRows.push(a);
        }
        return { count: args.data.length };
      },
      deleteMany: async (args: { where: { qualityProfileId: number } }) => {
        assignmentRows = assignmentRows.filter(
          (a) => a.qualityProfileId !== args.where.qualityProfileId,
        );
        return { count: 0 };
      },
    },
  };
}

// ── Prisma stub ───────────────────────────────────────────────────────────────

const prismaQpStub = {
  qualityProfile: {
    findMany: mock(async (args?: { orderBy?: unknown; include?: unknown }) => {
      const rows = [...profileRows.values()];
      if (
        args?.orderBy &&
        typeof args.orderBy === "object" &&
        "name" in (args.orderBy as object)
      ) {
        const dir = (args.orderBy as { name: string }).name === "asc" ? 1 : -1;
        rows.sort((a, b) => dir * a.name.localeCompare(b.name));
      }
      return rows.map(buildProfileWithFormats);
    }),
    findUnique: mock(async (args: { where: { id: number } }) => {
      return profileRows.get(args.where.id) ?? null;
    }),
    delete: mock(async (args: { where: { id: number } }) => {
      const row = profileRows.get(args.where.id);
      if (!row) throw Object.assign(new Error("Not found"), { code: "P2025" });
      profileRows.delete(args.where.id);
      return row;
    }),
  },
  libraryMedia: {
    count: mock(async () => 0),
  },
  user: {
    findUnique: mock(async () => injectedDbUser),
  },
  $transaction: mock(
    async (cb: (tx: ReturnType<typeof buildTxStub>) => Promise<unknown>) => {
      return cb(buildTxStub());
    },
  ),
};

// ── Top-level mocks ───────────────────────────────────────────────────────────

mock.module("@rawkoon/api/db", () => ({ prisma: prismaQpStub }));

mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        injectedDbUser ? { user: { id: injectedDbUser.id } } : null,
    },
    handler: async () => new Response("", { status: 404 }),
  },
}));

mock.module("@rawkoon/api/auth", () => ({
  auth: (app: Elysia) => app,
}));

// ── Lazy-import the route ─────────────────────────────────────────────────────

const { qualityProfilesRoutes } = await import("./index");

const app = new Elysia().use(qualityProfilesRoutes);

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_DB_USER: FakeDbUser = {
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

const REGULAR_DB_USER: FakeDbUser = {
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

const BASE_PROFILE = {
  name: "Test Profile",
  min_resolution: 1080,
  preferred_sources: ["WEB-DL"],
  preferred_codecs: ["H.264"],
  require_hdr: false,
  prefer_hdr: false,
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

function seedCustomFormat(name: string): CfRow {
  const id = nextFormatId++;
  const row: CfRow = {
    id,
    name,
    conditions: [{ type: "source", operator: "equals", value: "WEB-DL" }],
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
  formatRows.set(id, row);
  return row;
}

async function createProfile(overrides: Record<string, unknown> = {}) {
  const res = await app.handle(
    jsonReq("/api/quality-profiles", "POST", {
      ...BASE_PROFILE,
      ...overrides,
    }),
  );
  return ((await res.json()) as any).profile as { id: number; name: string };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.serial("Quality Profiles API", () => {
  beforeEach(() => {
    injectedDbUser = ADMIN_DB_USER;
    nextProfileId = 1;
    nextFormatId = 100;
    profileRows = new Map();
    assignmentRows = [];
    formatRows = new Map();
    simulateProfileDuplicate = false;
    simulateFkError = false;
    prismaQpStub.qualityProfile.findMany.mockClear();
    prismaQpStub.qualityProfile.findUnique.mockClear();
    prismaQpStub.qualityProfile.delete.mockClear();
    prismaQpStub.libraryMedia.count.mockClear();
    prismaQpStub.user.findUnique.mockClear();
    prismaQpStub.$transaction.mockClear();
  });

  it("POST basic profile → 201 with min_seeders default 0 and empty custom_formats", async () => {
    const res = await app.handle(
      jsonReq("/api/quality-profiles", "POST", BASE_PROFILE),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    const p = body.profile;
    expect(typeof p.id).toBe("number");
    expect(p.name).toBe("Test Profile");
    expect(p.min_seeders).toBe(0);
    expect(Array.isArray(p.custom_formats)).toBe(true);
    expect(p.custom_formats.length).toBe(0);
  });

  it("POST with min_seeders + custom_format assignment → 201, correct values in GET", async () => {
    const fmt = seedCustomFormat("WEB-DL Format");
    const res = await app.handle(
      jsonReq("/api/quality-profiles", "POST", {
        ...BASE_PROFILE,
        name: "Seeded Profile",
        min_seeders: 3,
        custom_formats: [
          {
            custom_format_id: fmt.id,
            score: 200,
            required: false,
            forbidden: true,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    const p = body.profile;
    expect(p.min_seeders).toBe(3);
    expect(p.custom_formats.length).toBe(1);
    expect(p.custom_formats[0].custom_format_id).toBe(fmt.id);
    expect(p.custom_formats[0].name).toBe("WEB-DL Format");
    expect(p.custom_formats[0].score).toBe(200);
    expect(p.custom_formats[0].required).toBe(false);
    expect(p.custom_formats[0].forbidden).toBe(true);

    // Verify GET list also reflects the data
    const listRes = await app.handle(req("/api/quality-profiles"));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    const found = listBody.profiles.find((x: any) => x.id === p.id);
    expect(found).toBeDefined();
    expect(found.min_seeders).toBe(3);
    expect(found.custom_formats[0].score).toBe(200);
    expect(found.custom_formats[0].forbidden).toBe(true);
  });

  it("POST with unknown custom_format_id → 400 unknown custom_format_id", async () => {
    simulateFkError = true;
    const res = await app.handle(
      jsonReq("/api/quality-profiles", "POST", {
        ...BASE_PROFILE,
        name: "Bad Format Profile",
        custom_formats: [{ custom_format_id: 999999, score: 1 }],
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("unknown custom_format_id");
  });

  it("PUT with custom_formats: [] → clears assignments, min_seeders change persists", async () => {
    const fmt = seedCustomFormat("ClearMe");
    const profile = await createProfile({
      name: "Update Profile",
      min_seeders: 5,
      custom_formats: [{ custom_format_id: fmt.id, score: 100 }],
    });

    const putRes = await app.handle(
      jsonReq(`/api/quality-profiles/${profile.id}`, "PUT", {
        ...BASE_PROFILE,
        name: "Update Profile",
        min_seeders: 10,
        custom_formats: [],
      }),
    );
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as any;
    expect(putBody.profile.min_seeders).toBe(10);
    expect(putBody.profile.custom_formats.length).toBe(0);

    // Confirm via GET list
    const listRes = await app.handle(req("/api/quality-profiles"));
    const listBody = (await listRes.json()) as any;
    const found = listBody.profiles.find((x: any) => x.id === profile.id);
    expect(found.min_seeders).toBe(10);
    expect(found.custom_formats.length).toBe(0);
  });

  it("PUT omitting custom_formats leaves assignments untouched", async () => {
    const fmt = seedCustomFormat("Sticky");
    const profile = await createProfile({
      name: "Sticky Profile",
      custom_formats: [{ custom_format_id: fmt.id, score: 50 }],
    });

    // PUT without custom_formats field
    const putRes = await app.handle(
      jsonReq(`/api/quality-profiles/${profile.id}`, "PUT", {
        ...BASE_PROFILE,
        name: "Sticky Profile",
      }),
    );
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as any;
    // Assignments should be preserved (route only touches when custom_formats is provided)
    expect(putBody.profile.custom_formats.length).toBe(1);
    expect(putBody.profile.custom_formats[0].score).toBe(50);
  });

  it("POST duplicate name → 409", async () => {
    await createProfile({ name: "Dup" });
    simulateProfileDuplicate = true;
    const res = await app.handle(
      jsonReq("/api/quality-profiles", "POST", {
        ...BASE_PROFILE,
        name: "Dup",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("returns 401 when unauthenticated", async () => {
    injectedDbUser = null;
    const res = await app.handle(req("/api/quality-profiles"));
    expect(res.status).toBe(401);
  });

  it("POST returns 403 when non-admin", async () => {
    injectedDbUser = REGULAR_DB_USER;
    const res = await app.handle(
      jsonReq("/api/quality-profiles", "POST", BASE_PROFILE),
    );
    expect(res.status).toBe(403);
  });
});
