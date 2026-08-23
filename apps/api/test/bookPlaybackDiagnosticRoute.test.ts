import { describe, it, expect, beforeEach, mock } from "bun:test";

// A media error on a locked iPhone leaves no trace anywhere: no server log
// (the element talks to the byte route, which cannot tell a dropped socket
// from a finished one) and no client console anyone will ever read. This
// endpoint is the breadcrumb, so the next occurrence is evidence instead of a
// guess. It must never fail the caller — a diagnostic that throws in the
// player's error handler makes the bug it is reporting worse.

const state: { logged: unknown[] } = { logged: [] };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    oidcProvider: { findMany: () => Promise.resolve([]) },
  },
}));

mock.module("@rawkoon/api/utils/activityLogs", () => ({
  logActivity: (input: unknown) => {
    state.logged.push(input);
    return Promise.resolve(undefined);
  },
}));

const { bookReadRoutes } = await import(
  "@rawkoon/api/routes/books/bookReadRoutes"
);

type Body = {
  edition_id: number;
  file_id?: number | null;
  file_index?: number | null;
  error_code?: number | null;
  current_time?: number | null;
  resume_offset?: number | null;
  retry_attempt?: number | null;
  online?: boolean | null;
};

type Handler = (ctx: {
  body: Body;
  user: { id: string };
  set: { status?: number };
}) => Promise<unknown>;

function diagnosticHandler(): Handler {
  const routes = (
    bookReadRoutes as unknown as {
      routes: Array<{ method: string; path: string; handler: Handler }>;
    }
  ).routes;
  const route = routes.find(
    (r) => r.method === "POST" && r.path.endsWith("/playback-diagnostic"),
  );
  if (!route) throw new Error("POST /playback-diagnostic not registered");
  return route.handler;
}

const post = (body: Body) =>
  diagnosticHandler()({ body, user: { id: "user-1" }, set: {} });

describe("POST /api/books/playback-diagnostic", () => {
  beforeEach(() => {
    state.logged = [];
  });

  it("records the error with the offsets that discriminate the cause", async () => {
    const result = await post({
      edition_id: 11,
      file_id: 112,
      file_index: 8,
      error_code: 2,
      current_time: 0,
      resume_offset: 112.4,
      retry_attempt: 1,
      online: true,
    });

    expect(result).toEqual({ recorded: true });
    expect(state.logged).toHaveLength(1);
    expect(state.logged[0]).toMatchObject({
      type: "book_playback_error",
      userId: "user-1",
      payload: {
        edition_id: 11,
        file_id: 112,
        file_index: 8,
        error_code: 2,
        current_time: 0,
        resume_offset: 112.4,
        retry_attempt: 1,
        online: true,
      },
    });
  });

  it("accepts a report carrying only the edition", async () => {
    const result = await post({ edition_id: 11 });

    expect(result).toEqual({ recorded: true });
    expect(state.logged).toHaveLength(1);
  });
});

type JournalBody = { events: Array<Record<string, unknown>> };

type JournalHandler = (ctx: {
  body: JournalBody;
  user: { id: string };
  set: { status?: number };
}) => Promise<unknown>;

function journalHandler(): JournalHandler {
  const routes = (
    bookReadRoutes as unknown as {
      routes: Array<{ method: string; path: string; handler: JournalHandler }>;
    }
  ).routes;
  const route = routes.find(
    (r) => r.method === "POST" && r.path.endsWith("/playback-journal"),
  );
  if (!route) throw new Error("POST /playback-journal not registered");
  return route.handler;
}

const postJournal = (body: JournalBody) =>
  journalHandler()({ body, user: { id: "user-1" }, set: {} });

describe("POST /api/books/playback-journal", () => {
  beforeEach(() => {
    state.logged = [];
  });

  // One row per batch, not per event: a chatty session would otherwise enqueue
  // a queue job per timeupdate-adjacent transition.
  it("records a whole batch as one activity row", async () => {
    const events = [
      {
        event: "load",
        edition_id: 11,
        file_index: 8,
        reason: "boundary",
        resume_offset: 0,
        position: 3312.5,
        at: "2026-08-23T12:19:00.000Z",
      },
      {
        event: "emptied",
        edition_id: 11,
        file_index: 8,
        current_time: 0,
        ready_state: 0,
        position: 3312.5,
        at: "2026-08-23T12:19:04.000Z",
      },
    ];

    const result = await postJournal({ events });

    expect(result).toEqual({ recorded: 2 });
    expect(state.logged).toHaveLength(1);
    expect(state.logged[0]).toMatchObject({
      type: "book_playback_trace",
      userId: "user-1",
      payload: { events },
    });
  });

  // The flusher can race itself empty; an empty batch is not an error.
  it("logs nothing for an empty batch", async () => {
    const result = await postJournal({ events: [] });

    expect(result).toEqual({ recorded: 0 });
    expect(state.logged).toEqual([]);
  });
});
