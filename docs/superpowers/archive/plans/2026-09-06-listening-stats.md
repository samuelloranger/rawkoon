# Listening Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record audiobook listening time from existing progress PUTs, expose hours/streak/series stats, and show them on a home card that opens a stats screen on web and iOS.

**Architecture:** A pure credit/calendar/series module decides what counts. The progress PUT increments `book_listening_daily` after a successful last-write-wins upsert. `GET /api/books/listening-stats` reads those buckets plus library series. Players do not change. Web and iOS only consume the GET.

**Tech Stack:** Bun, Elysia, Prisma 7 / Postgres, React 19 + TanStack Query/Router, SwiftUI iOS 18, i18next + String Catalog.

**Spec:** `docs/superpowers/specs/2026-09-06-listening-stats-design.md`

## Global Constraints

- No player / progress-request changes (`PlayerProvider`, `AudiobookPlayer`, PUT body stay as they are).
- Credit failure must not fail a progress save.
- No backfill. Hours start at ship. Series percent uses existing progress.
- No sidebar nav item. `/stats` is reached from the card (and by URL).
- No WidgetKit, no reading stats, no goal editor, no per-edition hour log.
- No version bump, tag, or GitHub release by an agent.
- EN + FR copy. Do not ship English-only UI.
- Day boundaries use `loadConfig().TZ` (default `America/New_York`).
- Mount `GET /listening-stats` on the books router **before** `bookListRoutes` so `/:id` cannot swallow it.
- Comments say why, one line. `noUnusedLocals` / `noUnusedParameters` are on.

---

## File structure

| File | Responsibility |
|---|---|
| `apps/api/src/services/books/listeningStatsMath.ts` | Pure: `creditSeconds`, `calendarDateInTz`, `addDaysYmd`, `isoWeekDays`, `streakDays`, `buildSeriesStats`. |
| `apps/api/src/services/books/listeningStatsMath.test.ts` | Colocated bun tests for the pure module. |
| `apps/api/src/services/books/listeningStats.ts` | Prisma: `incrementDaily`, `applyListeningCredit`, `getListeningStats`. |
| `apps/api/src/services/books/listeningStats.test.ts` | Mocked-prisma tests for credit hook + GET assembly. |
| `apps/api/prisma/schema.prisma` | `BookListeningDaily` + `User.listeningDaily`. |
| `apps/api/prisma/migrations/20260906120000_book_listening_daily/migration.sql` | Create table. |
| `apps/api/src/routes/books/bookListeningStatsRoutes.ts` | `GET /listening-stats`. |
| `apps/api/src/routes/books/index.ts` | `.use(bookListeningStatsRoutes)` before list routes. |
| `apps/api/src/routes/books/bookPlaybackRoutes.ts` | After applied upsert, call `applyListeningCredit`. |
| `apps/shared/src/types/books.ts` | `BookListeningStats`, `BookListeningSeriesStat`. |
| `apps/web/src/lib/endpoints/books.ts` | `LISTENING_STATS`. |
| `apps/web/src/lib/queryKeys.ts` | `books.listeningStats()`. |
| `apps/web/src/features/listening/*` | Hours formatter, hook, widget, stats page body. |
| `apps/web/src/pages/stats/index.tsx` | Route `/stats`. |
| `apps/web/src/pages/_component/WidgetGrid.tsx` | Insert listening widget. |
| `apps/web/src/locales/{en,fr}/common.json` | Copy under `listening`. |
| `apps/ios/Sources/RawkoonKit/Formatters.swift` | `listeningHours(_:)`. |
| `apps/ios/Tests/RawkoonKitTests/FormattersTests.swift` | Hours-format cases. |
| `apps/ios/Rawkoon/APIClient.swift` | `listeningStats()`, `systemFeatures()`. |
| `apps/ios/Rawkoon/Models.swift` | DTOs. |
| `apps/ios/Rawkoon/Views/ListeningStatsCard.swift` | Home card. |
| `apps/ios/Rawkoon/Views/ListeningStatsView.swift` | Pushed stats screen. |
| `apps/ios/Rawkoon/Views/HomeView.swift` | Place the card after Continue. |
| `apps/ios/Rawkoon/Localizable.xcstrings` | EN + FR strings. |

Players are not in this table on purpose.

---

### Task 1: Pure listening math

**Files:**
- Create: `apps/api/src/services/books/listeningStatsMath.ts`
- Test: `apps/api/src/services/books/listeningStatsMath.test.ts`

**Interfaces:**
- Consumes: nothing (no Prisma, no `loadConfig`).
- Produces:
  - `creditSeconds(previousPosition: number, newPosition: number, elapsedWallSecs: number): number`
  - `calendarDateInTz(instant: Date, timeZone: string): string` → `YYYY-MM-DD`
  - `addDaysYmd(ymd: string, deltaDays: number): string`
  - `isoWeekDays(todayYmd: string): string[]` — length 7, Monday first
  - `streakDays(daysWithSeconds: ReadonlySet<string>, todayYmd: string): number`
  - `buildSeriesStats(books: SeriesBookInput[]): BookListeningSeriesStat[]` — import the type from `@rawkoon/shared/types` **after** Task 4 adds it, **or** duplicate a local structural type in this file for Task 1 and switch the import in Task 4. For Task 1, define `SeriesBookInput` and `SeriesStat` **in this file** so Task 1 does not wait on shared types.

```ts
export type SeriesBookInput = {
  seriesName: string | null;
  title: string;
  hasAudiobook: boolean;
  finished: boolean;
  positionSecs: number;
  totalDurationSecs: number;
  updatedAtMs: number | null;
};

export type SeriesStat = {
  name: string;
  books_total: number;
  books_finished: number;
  percent: number;
  current_title: string | null;
};
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  addDaysYmd,
  buildSeriesStats,
  calendarDateInTz,
  creditSeconds,
  isoWeekDays,
  streakDays,
  type SeriesBookInput,
} from "@rawkoon/api/services/books/listeningStatsMath";

describe("creditSeconds", () => {
  test("seek back is 0", () => {
    expect(creditSeconds(100, 40, 10)).toBe(0);
  });
  test("10s PUT with +12s at 1x counts 12", () => {
    expect(creditSeconds(100, 112, 10)).toBe(12);
  });
  test("scrub +120s with 10s elapsed is 0", () => {
    expect(creditSeconds(100, 220, 10)).toBe(0);
  });
  test("offline +2700s position with 2700s elapsed counts 2700", () => {
    expect(creditSeconds(100, 2800, 2700)).toBe(2700);
  });
  test("negative elapsed is 0", () => {
    expect(creditSeconds(100, 112, -1)).toBe(0);
  });
  test("zero or negative delta is 0", () => {
    expect(creditSeconds(100, 100, 10)).toBe(0);
  });
});

describe("calendarDateInTz", () => {
  test("UTC morning is still previous evening in America/Toronto", () => {
    // 2026-09-07 03:30 UTC = 2026-09-06 23:30 EDT
    expect(
      calendarDateInTz(new Date("2026-09-07T03:30:00.000Z"), "America/Toronto"),
    ).toBe("2026-09-06");
  });
});

describe("isoWeekDays", () => {
  test("2026-09-01 (Tuesday) week starts 2026-08-31 (spans months)", () => {
    expect(isoWeekDays("2026-09-01")).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("streakDays", () => {
  test("empty is 0", () => {
    expect(streakDays(new Set(), "2026-09-06")).toBe(0);
  });
  test("today counts backward", () => {
    expect(
      streakDays(new Set(["2026-09-04", "2026-09-05", "2026-09-06"]), "2026-09-06"),
    ).toBe(3);
  });
  test("yesterday-only still counts (morning before today's listen)", () => {
    expect(streakDays(new Set(["2026-09-05"]), "2026-09-06")).toBe(1);
  });
  test("a gap breaks it", () => {
    expect(
      streakDays(new Set(["2026-09-03", "2026-09-06"]), "2026-09-06"),
    ).toBe(1);
  });
});

describe("buildSeriesStats", () => {
  const discworld = (title: string, extra: Partial<SeriesBookInput>) => ({
    seriesName: "Discworld",
    title,
    hasAudiobook: true,
    finished: false,
    positionSecs: 0,
    totalDurationSecs: 100,
    updatedAtMs: null,
    ...extra,
  });

  test("drops a one-book series and ebook-only books", () => {
    const stats = buildSeriesStats([
      discworld("Mort", {}),
      {
        seriesName: "Discworld",
        title: "Sourcery ebook",
        hasAudiobook: false,
        finished: false,
        positionSecs: 0,
        totalDurationSecs: 0,
        updatedAtMs: null,
      },
      {
        seriesName: "Standalone",
        title: "Alone",
        hasAudiobook: true,
        finished: true,
        positionSecs: 50,
        totalDurationSecs: 50,
        updatedAtMs: 1,
      },
    ]);
    expect(stats).toEqual([]);
  });

  test("finished is ratio 1; mean rounds to integer percent; current_title is latest in-progress", () => {
    const stats = buildSeriesStats([
      discworld("Mort", {
        finished: true,
        positionSecs: 90,
        totalDurationSecs: 100,
        updatedAtMs: 1,
      }),
      discworld("Sourcery", {
        positionSecs: 50,
        totalDurationSecs: 100,
        updatedAtMs: 9,
      }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].books_total).toBe(2);
    expect(stats[0].books_finished).toBe(1);
    expect(stats[0].percent).toBe(75);
    expect(stats[0].current_title).toBe("Sourcery");
  });
});
```

Fix the `Parameters<>` helper if it is noisy — inline `SeriesBookInput` once the module exists. The test file must compile; do not leave a `Parameters` trick that `tsc` rejects. Use `SeriesBookInput` imported from the module.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/api && bun test src/services/books/listeningStatsMath.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

```ts
export type SeriesBookInput = {
  seriesName: string | null;
  title: string;
  hasAudiobook: boolean;
  finished: boolean;
  positionSecs: number;
  totalDurationSecs: number;
  updatedAtMs: number | null;
};

export type SeriesStat = {
  name: string;
  books_total: number;
  books_finished: number;
  percent: number;
  current_title: string | null;
};

export function creditSeconds(
  previousPosition: number,
  newPosition: number,
  elapsedWallSecs: number,
): number {
  if (elapsedWallSecs < 0) return 0;
  const delta = newPosition - previousPosition;
  const max = elapsedWallSecs * 2 + 15;
  if (delta <= 0 || delta > max) return 0;
  return delta;
}

export function calendarDateInTz(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays);
  return new Date(utc).toISOString().slice(0, 10);
}

export function isoWeekDays(todayYmd: string): string[] {
  const [y, m, d] = todayYmd.split("-").map(Number);
  const mon0 = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const monday = addDaysYmd(todayYmd, -mon0);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDaysYmd(monday, i));
}

export function streakDays(
  daysWithSeconds: ReadonlySet<string>,
  todayYmd: string,
): number {
  const yesterday = addDaysYmd(todayYmd, -1);
  const start = daysWithSeconds.has(todayYmd)
    ? todayYmd
    : daysWithSeconds.has(yesterday)
      ? yesterday
      : null;
  if (!start) return 0;
  let count = 0;
  let cursor = start;
  while (daysWithSeconds.has(cursor)) {
    count += 1;
    cursor = addDaysYmd(cursor, -1);
  }
  return count;
}

function bookRatio(book: SeriesBookInput): number {
  if (book.finished) return 1;
  if (book.totalDurationSecs > 0) {
    return Math.min(1, Math.max(0, book.positionSecs / book.totalDurationSecs));
  }
  return 0;
}

export function buildSeriesStats(books: SeriesBookInput[]): SeriesStat[] {
  const groups = new Map<string, SeriesBookInput[]>();
  for (const book of books) {
    if (!book.hasAudiobook || !book.seriesName) continue;
    const list = groups.get(book.seriesName) ?? [];
    list.push(book);
    groups.set(book.seriesName, list);
  }

  const stats: SeriesStat[] = [];
  for (const [name, members] of groups) {
    if (members.length < 2) continue;
    const ratios = members.map(bookRatio);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const inProgress = members
      .filter((b) => !b.finished && b.positionSecs > 1)
      .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
    stats.push({
      name,
      books_total: members.length,
      books_finished: members.filter((b) => b.finished).length,
      percent: Math.round(mean * 100),
      current_title: inProgress[0]?.title ?? null,
    });
  }

  stats.sort((a, b) => {
    const aIn = a.current_title ? 0 : 1;
    const bIn = b.current_title ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    if (a.current_title && b.current_title) {
      const aBook = books.find((x) => x.title === a.current_title);
      const bBook = books.find((x) => x.title === b.current_title);
      const dt = (bBook?.updatedAtMs ?? 0) - (aBook?.updatedAtMs ?? 0);
      if (dt !== 0) return dt;
    }
    return a.name.localeCompare(b.name);
  });
  return stats;
}
```

Sort of in-progress series must use each group's latest `updatedAtMs`, not a `books.find` by title (titles can collide). When implementing, store `currentUpdatedAtMs` on a local object during the loop and sort on that. Tests only require Sourcery-before-finished ordering within one series plus alphabetical for the rest.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/api && bun test src/services/books/listeningStatsMath.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/books/listeningStatsMath.ts apps/api/src/services/books/listeningStatsMath.test.ts
git commit -m "$(cat <<'EOF'
feat(api): pure listening credit, streak, and series math

EOF
)"
```

---

### Task 2: Daily bucket table

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`User` relations around line 42; new model after `BookListeningProgress`)
- Create: `apps/api/prisma/migrations/20260906120000_book_listening_daily/migration.sql`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: Prisma model `BookListeningDaily` mapped to `book_listening_daily`, composite id `userId_day`.

- [ ] **Step 1: Add the model and User relation**

On `User`, next to `bookProgress`:

```
listeningDaily BookListeningDaily[]
```

After `BookListeningProgress`:

```
model BookListeningDaily {
  userId  String   @map("user_id")
  day     DateTime @db.Date
  seconds Float
  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, day])
  @@map("book_listening_daily")
}
```

- [ ] **Step 2: Write the migration SQL**

```sql
CREATE TABLE "book_listening_daily" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "seconds" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "book_listening_daily_pkey" PRIMARY KEY ("user_id","day")
);

ALTER TABLE "book_listening_daily" ADD CONSTRAINT "book_listening_daily_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate the client**

```bash
cd /home/samuelloranger/sites/rawkoon && bun run db:generate
```

Expected: Prisma client regenerates with `bookListeningDaily`. Apply against the **dev** DB only if you need a running API this session: `bun run db:migrate:deploy` from `apps/api` with root `.env` loaded. Do not run `db:migrate:dev` against production.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260906120000_book_listening_daily/migration.sql
git commit -m "$(cat <<'EOF'
feat(api): add book_listening_daily buckets

EOF
)"
```

---

### Task 3: Credit on progress PUT

**Files:**
- Create: `apps/api/src/services/books/listeningStats.ts`
- Test: `apps/api/src/services/books/listeningStats.test.ts`
- Modify: `apps/api/src/routes/books/bookPlaybackRoutes.ts` (progress PUT, the `findUnique` select and the block after upsert)

**Interfaces:**
- Consumes: `creditSeconds`, `calendarDateInTz` from Task 1; `prisma.bookListeningDaily` from Task 2; `loadConfig().TZ`.
- Produces:
  - `ymdToUtcDate(ymd: string): Date` — `new Date(`${ymd}T00:00:00.000Z`)`
  - `incrementDaily(userId: string, receivedAt: Date, seconds: number): Promise<void>`
  - `applyListeningCredit(input: { userId: string; created: boolean; previous: { positionSecs: number; receivedAt: Date } | null; newPosition: number; receivedAt: Date }): Promise<void>`

`applyListeningCredit` no-ops when `created` is true, `previous` is null, or `creditSeconds` is 0. Otherwise it `try/catch`es `incrementDaily` and `console.error`s on failure.

- [ ] **Step 1: Write failing tests** (mock `@rawkoon/api/db` **before** importing `listeningStats`)

```ts
import { beforeEach, describe, expect, mock, test } from "bun:test";

const upserts: Array<{
  where: unknown;
  create: { seconds: number };
  update: { seconds: { increment: number } };
}> = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    oidcProvider: { findMany: () => Promise.resolve([]) },
    bookListeningDaily: {
      upsert: (args: (typeof upserts)[number]) => {
        upserts.push(args);
        return Promise.resolve({});
      },
    },
  },
}));

mock.module("@rawkoon/api/config", () => ({
  loadConfig: () => ({ TZ: "America/Toronto" }),
}));

const { applyListeningCredit } = await import(
  "@rawkoon/api/services/books/listeningStats"
);

describe("applyListeningCredit", () => {
  beforeEach(() => {
    upserts.length = 0;
  });

  test("first PUT (created) writes nothing", async () => {
    await applyListeningCredit({
      userId: "u1",
      created: true,
      previous: null,
      newPosition: 30,
      receivedAt: new Date("2026-09-06T18:00:00.000Z"),
    });
    expect(upserts).toHaveLength(0);
  });

  test("applied forward delta increments today", async () => {
    await applyListeningCredit({
      userId: "u1",
      created: false,
      previous: {
        positionSecs: 100,
        receivedAt: new Date("2026-09-06T17:59:50.000Z"),
      },
      newPosition: 112,
      receivedAt: new Date("2026-09-06T18:00:00.000Z"),
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].create.seconds).toBe(12);
    expect(upserts[0].update.seconds.increment).toBe(12);
  });

  test("LWW loser is not this function's job — caller must not invoke it", async () => {
    expect(upserts).toHaveLength(0);
  });
});
```

Delete the empty LWW test — the route simply does not call `applyListeningCredit` when `applied` is false. Add a test that a credit throw is swallowed:

```ts
test("increment throw is swallowed", async () => {
  mock.module("@rawkoon/api/db", () => ({
    prisma: {
      oidcProvider: { findMany: () => Promise.resolve([]) },
      bookListeningDaily: {
        upsert: () => Promise.reject(new Error("disk full")),
      },
    },
  }));
  // Re-importing after a second mock.module in the same file is fragile
  // under bun test without --isolate. Instead, implement incrementDaily
  // so applyListeningCredit try/catches it, and unit-test that by
  // stubbing increment via a thrown upsert in THIS file's single mock:
});
```

Do **not** double-`mock.module` in one file. One prisma mock: make `upsert` reject when `seconds === 999`. Then:

```ts
test("increment throw is swallowed", async () => {
  await applyListeningCredit({
    userId: "u1",
    created: false,
    previous: {
      positionSecs: 0,
      receivedAt: new Date("2026-09-06T17:00:00.000Z"),
    },
    newPosition: 999,
    receivedAt: new Date("2026-09-06T18:00:00.000Z"),
  });
  // elapsed is 3600s, delta 999 ≤ 3600*2+15, so it will call upsert.
});
```

Change the mock upsert to `if (args.create.seconds === 999) return Promise.reject(new Error("disk full"));`. Expect the call **not** to throw.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/api && bun test src/services/books/listeningStats.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `listeningStats.ts` (credit + increment only in this task)**

```ts
import { prisma } from "@rawkoon/api/db";
import { loadConfig } from "@rawkoon/api/config";
import {
  calendarDateInTz,
  creditSeconds,
} from "@rawkoon/api/services/books/listeningStatsMath";

export function ymdToUtcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export async function incrementDaily(
  userId: string,
  receivedAt: Date,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return;
  const day = ymdToUtcDate(calendarDateInTz(receivedAt, loadConfig().TZ));
  await prisma.bookListeningDaily.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, seconds },
    update: { seconds: { increment: seconds } },
  });
}

export async function applyListeningCredit(input: {
  userId: string;
  created: boolean;
  previous: { positionSecs: number; receivedAt: Date } | null;
  newPosition: number;
  receivedAt: Date;
}): Promise<void> {
  if (input.created || !input.previous) return;
  const elapsed =
    (input.receivedAt.getTime() - input.previous.receivedAt.getTime()) / 1000;
  const credited = creditSeconds(
    input.previous.positionSecs,
    input.newPosition,
    elapsed,
  );
  if (credited <= 0) return;
  try {
    await incrementDaily(input.userId, input.receivedAt, credited);
  } catch (error) {
    console.error("[listeningStats] credit failed:", error);
  }
}
```

Leave `getListeningStats` for Task 4. `noImplicitReturns` / unused exports are fine if you do not export a stub.

- [ ] **Step 4: Wire the progress PUT**

In `bookPlaybackRoutes.ts` progress PUT:

1. Expand the `findUnique` select to `{ updatedAt: true, positionSecs: true, receivedAt: true }`.
2. Keep the LWW early return `{ applied: false }` — **do not** credit.
3. After a successful upsert, call:

```ts
await applyListeningCredit({
  userId: user!.id,
  created: !existing,
  previous: existing,
  newPosition: body.position_secs,
  receivedAt: now,
});
```

Import `applyListeningCredit` from `@rawkoon/api/services/books/listeningStats`.

- [ ] **Step 5: Run tests**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/api && bun test src/services/books/listeningStats.test.ts src/services/books/listeningStatsMath.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/books/listeningStats.ts apps/api/src/services/books/listeningStats.test.ts apps/api/src/routes/books/bookPlaybackRoutes.ts
git commit -m "$(cat <<'EOF'
feat(api): credit listening seconds on progress PUT

EOF
)"
```

---

### Task 4: GET `/api/books/listening-stats`

**Files:**
- Modify: `apps/shared/src/types/books.ts` (append types after `BookListeningProgressRequest`)
- Modify: `apps/api/src/services/books/listeningStats.ts` (add `getListeningStats`)
- Modify: `apps/api/src/services/books/listeningStats.test.ts` (GET assembly cases)
- Create: `apps/api/src/routes/books/bookListeningStatsRoutes.ts`
- Modify: `apps/api/src/routes/books/index.ts`

**Interfaces:**
- Consumes: Task 1 math, Task 2 table, Task 3 `ymdToUtcDate` / `loadConfig().TZ`.
- Produces: `getListeningStats(userId: string): Promise<BookListeningStats>` and `GET /api/books/listening-stats`.

Shared types (verbatim):

```ts
export interface BookListeningSeriesStat {
  name: string;
  books_total: number;
  books_finished: number;
  percent: number;
  current_title: string | null;
}

export interface BookListeningWeekDay {
  day: string;
  seconds: number;
}

export interface BookListeningStats {
  timezone: string;
  today_secs: number;
  week_secs: number;
  streak_days: number;
  since: string | null;
  week: BookListeningWeekDay[];
  series: BookListeningSeriesStat[];
}
```

- [ ] **Step 1: Add the shared types**

Append the interfaces above to `apps/shared/src/types/books.ts`. Already re-exported via `apps/shared/src/types/index.ts`.

- [ ] **Step 2: Extend the listeningStats tests**

Add cases against `getListeningStats` with prisma mocked to return:

- no daily rows + no library books → zeros, `since: null`, `series: []`, `week.length === 7`
- two Discworld audiobooks, one finished, **no** daily rows → `since: null`, `series[0].percent === 75`

Mock `libraryBook.findMany` and `bookListeningDaily.findMany`. Keep the existing upsert mock.

Pin “now” by passing it into `getListeningStats(userId, now = new Date())` so tests do not depend on the wall clock. Production route calls `getListeningStats(user!.id)`.

- [ ] **Step 3: Run tests to verify GET cases fail**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/api && bun test src/services/books/listeningStats.test.ts
```

Expected: FAIL (`getListeningStats` missing).

- [ ] **Step 4: Implement `getListeningStats`**

Query daily rows for the user (`orderBy: { day: "asc" }`). Query library books:

```
select: {
  title: true,
  seriesName: true,
  editions: {
    where: { kind: "audiobook" },
    select: {
      progress: {
        where: { userId },
        select: {
          finished: true,
          positionSecs: true,
          totalDurationSecs: true,
          updatedAt: true,
        },
      },
    },
  },
}
```

Map each book to `SeriesBookInput` (`hasAudiobook: editions.length > 0`, progress from `editions[0]?.progress[0]`).

Build `week` from `isoWeekDays(todayYmd)` with seconds from a `Map<ymd, number>` of daily rows (`calendarDateInTz` of each row's `day`, or `day.toISOString().slice(0,10)` since we store UTC midnight). `today_secs` is today's bucket or 0. `week_secs` is the sum of `week`. `streak_days` uses days where `seconds > 0`. `since` is the first daily row's ymd or null. `timezone` is `loadConfig().TZ`.

- [ ] **Step 5: Add the route and mount it first**

```ts
import { Elysia } from "elysia";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { getListeningStats } from "@rawkoon/api/services/books/listeningStats";

export const bookListeningStatsRoutes = new Elysia()
  .use(requireUser)
  .get("/listening-stats", async ({ user }) => getListeningStats(user!.id));
```

In `apps/api/src/routes/books/index.ts`, `.use(bookListeningStatsRoutes)` **immediately after** `.use(auth)` and **before** `.use(bookListRoutes)`. Update the file comment.

- [ ] **Step 6: Run tests**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/api && bun test src/services/books/listeningStats.test.ts src/services/books/listeningStatsMath.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/shared/src/types/books.ts apps/api/src/services/books/listeningStats.ts apps/api/src/services/books/listeningStats.test.ts apps/api/src/routes/books/bookListeningStatsRoutes.ts apps/api/src/routes/books/index.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /api/books/listening-stats

EOF
)"
```

---

### Task 5: Web home card and `/stats`

**Files:**
- Modify: `apps/web/src/lib/endpoints/books.ts` — add `LISTENING_STATS: "/api/books/listening-stats"`
- Modify: `apps/web/src/lib/queryKeys.ts` — inside `books`, add `listeningStats: () => ["books", "listening-stats"] as const`
- Create: `apps/web/src/features/listening/formatListeningHours.ts`
- Test: `apps/web/src/features/listening/formatListeningHours.test.ts`
- Create: `apps/web/src/features/listening/useListeningStats.ts`
- Create: `apps/web/src/features/listening/ListeningStatsWidget.tsx`
- Test: `apps/web/src/features/listening/ListeningStatsWidget.test.tsx`
- Create: `apps/web/src/features/listening/ListeningStatsPage.tsx`
- Create: `apps/web/src/pages/stats/index.tsx`
- Modify: `apps/web/src/pages/_component/WidgetGrid.tsx` and `WidgetGrid.test.tsx`
- Modify: `apps/web/src/locales/en/common.json` and `apps/web/src/locales/fr/common.json`

**Interfaces:**
- Consumes: `BookListeningStats` from `@rawkoon/shared/types`; `useFeatures().books_enabled`; `GET /api/books/listening-stats`.
- Produces: widget + `/stats` route.

Copy keys (under `listening`, not `dashboard.home`):

| Key | EN | FR |
|---|---|---|
| `listening.title` | Listening | Écoute |
| `listening.streak_one` | 1 day streak | 1 jour de série |
| `listening.streak_other` | {{count}} day streak | {{count}} jours de série |
| `listening.hoursHint` | Hours start now — listen and they'll add up. | Les heures commencent maintenant — écoutez et elles s'accumuleront. |
| `listening.emptySeries` | No series in the library yet. | Aucune série dans la bibliothèque pour l'instant. |
| `listening.thisWeek` | This week | Cette semaine |
| `listening.series` | Series | Séries |
| `listening.seriesLine` | {{name}} · {{percent}}% | {{name}} · {{percent}} % |
| `listening.booksOf` | {{count}} of {{total}} | {{count}} sur {{total}} |
| `listening.loadError` | Couldn't load listening stats. | Impossible de charger les stats d'écoute. |

- [ ] **Step 1: Hours formatter tests**

```ts
import { describe, expect, it } from "vitest";
import { formatListeningHours } from "./formatListeningHours";

describe("formatListeningHours", () => {
  it("zero is 0h", () => {
    expect(formatListeningHours(0)).toBe("0h");
  });
  it("under an hour is minutes", () => {
    expect(formatListeningHours(20 * 60)).toBe("20m");
  });
  it("hours and unpadded minutes", () => {
    expect(formatListeningHours(3 * 3600 + 20 * 60)).toBe("3h 20m");
  });
});
```

```ts
export function formatListeningHours(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s === 0) return "0h";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
```

- [ ] **Step 2: Run formatter test (fail then pass)**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/web && bun run test src/features/listening/formatListeningHours.test.ts
```

- [ ] **Step 3: Hook + widget**

`useListeningStats`:

```ts
export function useListeningStats() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.books.listeningStats(),
    queryFn: () => fetcher<BookListeningStats>(BOOKS_ENDPOINTS.LISTENING_STATS),
  });
}
```

Widget: `useFeatures()` — if `books_enabled === false`, return `null`. If both listening query and features are loading, return `null` (no flash). If query is error, return `null` (same as Continue listening when both progress queries error). Otherwise `WidgetShell` + `WidgetHeader` (Headphones icon, `t("listening.title")`), three figures, optional series line (`series.find(s => s.current_title)`), hint when `since === null`. Root is a `<button>` that `navigate({ to: "/stats" })`.

Widget test: mock `useFeatures` → `{ data: { books_enabled: true } }`, mock `useListeningStats` with a fixture (`week_secs: 12000`, `streak_days: 3`, `since: "2026-09-01"`, one series with `current_title`). `renderWithProviders` + assert title, `3h 20m`, series line. Second case: `books_enabled: false` → empty.

- [ ] **Step 4: Stats page and route**

`pages/stats/index.tsx`:

```ts
export const Route = createFileRoute("/stats")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
  },
  component: ListeningStatsRoute,
});
```

`ListeningStatsPage`: if features loaded and `!books_enabled`, `<Navigate to="/" />`. Else page header `listening.title`, the three figures (no hint), seven bars (`week`, height `seconds / max(week.seconds, 1)`, zero days height 0), series list. Use `PageLayout` / `PageHeader` like other pages.

Week bar `aria-label` is the day + hours string.

- [ ] **Step 5: Insert into WidgetGrid**

Immediately after the Continue `CardErrorBoundary`, add one for `ListeningStatsWidget`. Update `WidgetGrid.test.tsx` mock + expected test id `w-listening`.

- [ ] **Step 6: Locales**

Add the `listening` object to both `en` and `fr` `common.json` (top-level, sibling of `books`). i18next plurals: `streak_one` / `streak_other` (English) and the same keys in French.

- [ ] **Step 7: Verify**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/web && bun run test src/features/listening src/pages/_component/WidgetGrid.test.tsx
cd /home/samuelloranger/sites/rawkoon && bun run --filter @rawkoon/web typecheck
```

Expected: PASS. Router will generate `routeTree.gen.ts` on `dev:web` / postinstall; do not hand-edit it. If typecheck fails on missing `Route` for `/stats`, run `bunx @tanstack/router-cli generate` in `apps/web`.

Browser: open `/`, confirm the Listening card (books on), tap through to `/stats`, confirm week bars + series. Toggle is not required if you cannot reach settings; at minimum hit `/stats` authenticated.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/endpoints/books.ts apps/web/src/lib/queryKeys.ts apps/web/src/features/listening apps/web/src/pages/stats apps/web/src/pages/_component/WidgetGrid.tsx apps/web/src/pages/_component/WidgetGrid.test.tsx apps/web/src/locales/en/common.json apps/web/src/locales/fr/common.json
git commit -m "$(cat <<'EOF'
feat(web): listening stats card and /stats page

EOF
)"
```

---

### Task 6: iOS home card and stats screen

**Files:**
- Modify: `apps/ios/Sources/RawkoonKit/Formatters.swift` — add `listeningHours`
- Modify: `apps/ios/Tests/RawkoonKitTests/FormattersTests.swift`
- Modify: `apps/ios/Rawkoon/Models.swift` — DTOs
- Modify: `apps/ios/Rawkoon/APIClient.swift` — `listeningStats()`, `systemFeatures()`
- Create: `apps/ios/Rawkoon/Views/ListeningStatsCard.swift`
- Create: `apps/ios/Rawkoon/Views/ListeningStatsView.swift`
- Modify: `apps/ios/Rawkoon/Views/HomeView.swift`
- Modify: `apps/ios/Rawkoon/Localizable.xcstrings`

**Interfaces:**
- Consumes: `GET /api/books/listening-stats`, `GET /api/system/features`.
- Produces: card after Continue on Home (admin tab), push to `ListeningStatsView`.

XcodeGen already compiles everything under `Rawkoon/`. No `project.yml` source-list edit.

- [ ] **Step 1: Kit formatter tests**

Add to `FormattersTests.swift`:

```swift
@Test func listeningHoursZeroIs0h() {
    #expect(Formatters.listeningHours(0) == "0h")
}
@Test func listeningHoursUnderAnHourIsMinutes() {
    #expect(Formatters.listeningHours(20 * 60) == "20m")
}
@Test func listeningHoursUnpadded() {
    #expect(Formatters.listeningHours(3 * 3600 + 20 * 60) == "3h 20m")
}
```

Implement:

```swift
public static func listeningHours(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else { return "0h" }
    let total = Int(seconds.rounded(.down))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    if hours == 0 { return "\(minutes)m" }
    return "\(hours)h \(minutes)m"
}
```

- [ ] **Step 2: Run Kit tests**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/ios && swift test --filter FormattersTests
```

Linux CI can run this. Expected: PASS after implementation.

- [ ] **Step 3: DTOs + client**

In `Models.swift` (nonisolated, `Decodable`, `Sendable`, snake_case via the client's convert strategy):

```swift
struct SystemFeatures: Decodable, Sendable {
    let booksEnabled: Bool
}

struct ListeningSeriesStat: Decodable, Sendable, Identifiable {
    var id: String { name }
    let name: String
    let booksTotal: Int
    let booksFinished: Int
    let percent: Int
    let currentTitle: String?
}

struct ListeningWeekDay: Decodable, Sendable, Identifiable {
    var id: String { day }
    let day: String
    let seconds: Double
}

struct ListeningStats: Decodable, Sendable {
    let timezone: String
    let todaySecs: Double
    let weekSecs: Double
    let streakDays: Int
    let since: String?
    let week: [ListeningWeekDay]
    let series: [ListeningSeriesStat]
}
```

`APIClient`:

```swift
func systemFeatures() async throws -> SystemFeatures {
    try await get("/api/system/features")
}

func listeningStats() async throws -> ListeningStats {
    try await get("/api/books/listening-stats")
}
```

`get` already uses convertFromSnakeCase on `mediaDecoder` — confirm `get`’s decoder matches progress. If `get` does **not** convert snake_case, decode these two calls the same way `getProgress` does (explicit `convertFromSnakeCase`). Do not break other `get` callers.

- [ ] **Step 4: Card + page**

`ListeningStatsCard`: `@Environment(AppModel.self)`, `.task(id: refreshToken)` loads features then stats. If `!features.booksEnabled`, render `Color.clear.frame(width: 0, height: 0)` (same “stay in the tree” trick as Continue). On error, hide like Continue (clear). On success, `NavigationLink` to `ListeningStatsView(stats:)` wrapping the same `widgetCard` chrome as Home (`Label("Listening", systemImage: "headphones")` — or pass a `ViewBuilder` and reuse `HomeView`’s private `widgetCard` by **not** duplicating: put the card UI inside HomeView as `listeningWidget` **or** extract `widgetCard` only if it stays file-private and the card lives in `HomeView.swift`. Prefer **one new file** `ListeningStatsCard.swift` that copies the existing card chrome (raised rect, 16pt padding) rather than ripping `widgetCard` out of HomeView.

Show streak (`^[\(stats.streakDays) day streak]` with `String(localized:)` plural), `Formatters.listeningHours(stats.weekSecs)`, series line from `stats.series.first(where: { $0.currentTitle != nil })`, hint if `stats.since == nil`.

`ListeningStatsView`: navigation title “Listening”, same three figures, seven bars, series rows (`booksFinished of booksTotal`, percent, currentTitle). No hint line.

- [ ] **Step 5: HomeView**

After `ContinueListeningView(...)`, insert:

```swift
ListeningStatsCard(refreshToken: continueToken)
    .padding(.horizontal, 16)
```

Bump `continueToken` already happens on pull-to-refresh — reuse it so stats reload with Continue.

- [ ] **Step 6: Localization**

Add to `Localizable.xcstrings` (en + fr) every new `String(localized:)`:

| EN | FR |
|---|---|
| Listening | Écoute |
| 1 day streak | 1 jour de série |
| %lld day streak | %lld jours de série |
| Hours start now — listen and they'll add up. | Les heures commencent maintenant — écoutez et elles s'accumuleront. |
| No series in the library yet. | Aucune série dans la bibliothèque pour l'instant. |
| This week | Cette semaine |
| Series | Séries |
| %lld of %lld | %lld sur %lld |
| Couldn't load listening stats. | Impossible de charger les stats d'écoute. |

Use `String(localized: "\(count) day streak")` / `String.LocalizationValue` so the catalog gets a plural. Match an existing plural in the catalog (e.g. other `%lld` strings) rather than inventing a new extraction style.

Run:

```bash
cd /home/samuelloranger/sites/rawkoon/apps/ios && python3 scripts/check-l10n.py
```

Expected: exit 0. If it lists missing keys, add them before committing.

- [ ] **Step 7: Verify**

```bash
cd /home/samuelloranger/sites/rawkoon/apps/ios && swift test
```

Expected: existing Kit tests + new hours tests PASS on Linux.

On macbuild (required before claiming iOS done): `git fetch` + checkout this branch, then `swift test` and `xcodebuild` BUILD SUCCEEDED. Simulator: Home (admin) shows the card, tap opens stats. No release.

- [ ] **Step 8: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/Formatters.swift apps/ios/Tests/RawkoonKitTests/FormattersTests.swift apps/ios/Rawkoon/Models.swift apps/ios/Rawkoon/APIClient.swift apps/ios/Rawkoon/Views/ListeningStatsCard.swift apps/ios/Rawkoon/Views/ListeningStatsView.swift apps/ios/Rawkoon/Views/HomeView.swift apps/ios/Rawkoon/Localizable.xcstrings
git commit -m "$(cat <<'EOF'
feat(ios): listening stats card and screen

EOF
)"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| `creditSeconds` heuristic + tests | 1 |
| Instance TZ calendar days | 1 + 3 (`loadConfig().TZ`) |
| ISO week Mon–Sun including month span | 1 |
| Streak today-or-yesterday | 1 |
| Series: 2+ audiobook books, ebook-only dropped, finished=1, integer percent, current_title | 1 + 4 |
| `book_listening_daily` | 2 |
| PUT LWW loser credits 0; first PUT credits 0; increment atomic; throw swallowed | 3 |
| Players unchanged | (none touch them) |
| `GET /api/books/listening-stats` zeros + `since: null`; no books_enabled gate | 4 |
| Route mounted before `/:id` | 4 |
| Web card hidden when books off; still shows 0h + hint; tap → `/stats` | 5 |
| `/stats` redirects home when books off; no sidebar item | 5 |
| iOS card after Continue; hidden when books off; same GET | 6 |
| EN + FR | 5 + 6 |
| No WidgetKit / goals / reading / backfill / release | Global constraints |

No TBD left in task bodies. Shared type names in Task 4 match Task 5/6 DTO fields (`today_secs` → `todaySecs` via snake_case conversion).
