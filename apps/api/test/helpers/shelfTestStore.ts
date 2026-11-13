/**
 * In-memory stand-in for the Prisma models the shelves service touches, so the
 * route suite exercises real filtering, ordering and idempotency logic without a
 * database.
 */

export type ShelfRec = {
  id: number;
  name: string;
  description: string | null;
  orderMode: string;
  coverStyle: string;
  coverTmdbId: number | null;
  coverType: string | null;
  homeRow: boolean;
  visibleFrom: string | null;
  visibleTo: string | null;
  seedKey: string | null;
  position: number;
};

export type EntryRec = {
  id: number;
  shelfId: number;
  tmdbId: number;
  type: string;
  season: number | null;
  position: number;
  groupLabel: string | null;
  source: string;
  excluded: boolean;
  title: string;
  year: number | null;
  posterPath: string | null;
  addedAt: Date;
};

export type MediaRec = {
  id: number;
  tmdbId: number;
  type: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overrides: unknown;
};

type Where = Record<string, unknown>;

export const state = {
  shelves: [] as ShelfRec[],
  entries: [] as EntryRec[],
  media: [] as MediaRec[],
  shelfId: 1,
  entryId: 1,
};

export function resetState() {
  state.shelves = [];
  state.entries = [];
  state.media = [];
  state.shelfId = 1;
  state.entryId = 1;
}

const matches = (rec: Record<string, unknown>, where: Where = {}): boolean =>
  Object.entries(where).every(([field, expected]) => {
    const actual = rec[field];
    if (expected && typeof expected === "object" && "in" in expected) {
      return (expected as { in: unknown[] }).in.includes(actual);
    }
    return actual === expected;
  });

const sorted = <T extends Record<string, unknown>>(
  rows: T[],
  orderBy?: unknown,
): T[] => {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses as Record<string, "asc" | "desc">[]) {
      for (const [field, dir] of Object.entries(clause)) {
        const av = a[field] as number | string | Date;
        const bv = b[field] as number | string | Date;
        if (av === bv) continue;
        const order = av < bv ? -1 : 1;
        return dir === "desc" ? -order : order;
      }
    }
    return 0;
  });
};

const shelf = {
  findMany: async (args?: { where?: Where; orderBy?: unknown }) =>
    sorted(
      state.shelves.filter((rec) => matches(rec as never, args?.where)),
      args?.orderBy,
    ),
  findUnique: async (args: { where: { id: number } }) =>
    state.shelves.find((rec) => rec.id === args.where.id) ?? null,
  findFirst: async (args?: { orderBy?: unknown }) =>
    sorted(state.shelves as never, args?.orderBy)[0] ?? null,
  create: async (args: { data: Record<string, unknown> }) => {
    const rec: ShelfRec = {
      id: state.shelfId++,
      name: String(args.data.name ?? ""),
      description: (args.data.description as string | null) ?? null,
      orderMode: String(args.data.orderMode ?? "manual"),
      coverStyle: String(args.data.coverStyle ?? "mosaic"),
      coverTmdbId: (args.data.coverTmdbId as number | null) ?? null,
      coverType: (args.data.coverType as string | null) ?? null,
      homeRow: !!args.data.homeRow,
      visibleFrom: (args.data.visibleFrom as string | null) ?? null,
      visibleTo: (args.data.visibleTo as string | null) ?? null,
      seedKey: (args.data.seedKey as string | null) ?? null,
      position: Number(args.data.position ?? 0),
    };
    state.shelves.push(rec);
    return rec;
  },
  update: async (args: {
    where: { id: number };
    data: Record<string, unknown>;
  }) => {
    const rec = state.shelves.find((row) => row.id === args.where.id);
    if (!rec) throw new Error("not found");
    Object.assign(rec, args.data);
    return rec;
  },
  updateMany: async (args: { where: Where; data: Record<string, unknown> }) => {
    const rows = state.shelves.filter((rec) =>
      matches(rec as never, args.where),
    );
    for (const rec of rows) Object.assign(rec, args.data);
    return { count: rows.length };
  },
  deleteMany: async (args: { where: Where }) => {
    const before = state.shelves.length;
    state.shelves = state.shelves.filter(
      (rec) => !matches(rec as never, args.where),
    );
    return { count: before - state.shelves.length };
  },
};

const shelfEntry = {
  findMany: async (args?: { where?: Where; orderBy?: unknown }) =>
    sorted(
      state.entries.filter((rec) => matches(rec as never, args?.where)),
      args?.orderBy,
    ),
  findFirst: async (args?: { where?: Where; orderBy?: unknown }) =>
    sorted(
      state.entries.filter((rec) => matches(rec as never, args?.where)),
      args?.orderBy,
    )[0] ?? null,
  create: async (args: { data: Record<string, unknown> }) => {
    const rec: EntryRec = {
      id: state.entryId++,
      shelfId: Number(args.data.shelfId),
      tmdbId: Number(args.data.tmdbId),
      type: String(args.data.type),
      season: (args.data.season as number | null) ?? null,
      position: Number(args.data.position ?? 0),
      groupLabel: (args.data.groupLabel as string | null) ?? null,
      source: String(args.data.source ?? "manual"),
      excluded: !!args.data.excluded,
      title: String(args.data.title ?? ""),
      year: (args.data.year as number | null) ?? null,
      posterPath: (args.data.posterPath as string | null) ?? null,
      addedAt: new Date(),
    };
    state.entries.push(rec);
    return rec;
  },
  createMany: async (args: { data: Array<Record<string, unknown>> }) => {
    let count = 0;
    for (const data of args.data) {
      const dup = state.entries.some(
        (entry) =>
          entry.shelfId === data.shelfId &&
          entry.tmdbId === data.tmdbId &&
          entry.type === data.type &&
          entry.season === (data.season ?? null),
      );
      if (dup) continue;
      state.entries.push({
        id: state.entryId++,
        shelfId: Number(data.shelfId),
        tmdbId: Number(data.tmdbId),
        type: String(data.type),
        season: (data.season as number | null) ?? null,
        position: Number(data.position ?? 0),
        groupLabel: (data.groupLabel as string | null) ?? null,
        source: String(data.source ?? "manual"),
        excluded: false,
        title: String(data.title ?? ""),
        year: (data.year as number | null) ?? null,
        posterPath: (data.posterPath as string | null) ?? null,
        addedAt: new Date(),
      });
      count++;
    }
    return { count };
  },
  update: async (args: {
    where: { id: number };
    data: Record<string, unknown>;
  }) => {
    const rec = state.entries.find((entry) => entry.id === args.where.id);
    if (!rec) throw new Error("not found");
    Object.assign(rec, args.data);
    return rec;
  },
  delete: async (args: { where: { id: number } }) => {
    state.entries = state.entries.filter((entry) => entry.id !== args.where.id);
    return { id: args.where.id };
  },
};

const libraryMedia = {
  findMany: async (args: { where: { tmdbId?: { in: number[] } } }) =>
    state.media.filter((media) =>
      args.where.tmdbId?.in
        ? args.where.tmdbId.in.includes(media.tmdbId)
        : true,
    ),
  findUnique: async (args: { where: { id: number } }) =>
    state.media.find((media) => media.id === args.where.id) ?? null,
};

export const fakePrisma = {
  shelf,
  shelfEntry,
  libraryMedia,
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
};

export function seedShelf(overrides: Partial<ShelfRec> = {}): ShelfRec {
  const rec: ShelfRec = {
    id: state.shelfId++,
    name: "Shelf",
    description: null,
    orderMode: "manual",
    coverStyle: "mosaic",
    coverTmdbId: null,
    coverType: null,
    homeRow: false,
    visibleFrom: null,
    visibleTo: null,
    seedKey: null,
    position: 0,
    ...overrides,
  };
  state.shelves.push(rec);
  return rec;
}

export function addEntry(
  shelfId: number,
  overrides: Partial<EntryRec> = {},
): EntryRec {
  const rec: EntryRec = {
    id: state.entryId++,
    shelfId,
    tmdbId: 1,
    type: "movie",
    season: null,
    position: state.entries.filter((entry) => entry.shelfId === shelfId).length,
    groupLabel: null,
    source: "manual",
    excluded: false,
    title: "A title",
    year: 2000,
    posterPath: "/p.jpg",
    addedAt: new Date(),
    ...overrides,
  };
  state.entries.push(rec);
  return rec;
}
