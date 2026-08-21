/**
 * The "continue reading" list is a filter, and the filter is the whole feature:
 * a shelf full of books the user merely opened, or of files no browser can
 * render, is worse than an empty one.
 */
import { describe, it, expect, mock } from "bun:test";

type Row = {
  editionId: number;
  percent: number | null;
  locator: string | null;
  fileId: number | null;
  positionSecs: number | null;
  updatedAt: Date;
  edition: {
    kind: string;
    durationSecs: number | null;
    book: {
      id: number;
      title: string;
      authors: string[];
      coverUrl: string | null;
    };
    files: Array<{ format: string; durationSecs: number | null }>;
  };
};

let rows: Row[] = [];
/** The arguments the service passed, so the filtering can be asserted on. */
let lastArgs: {
  where: {
    userId: string;
    finishedAt: null;
    OR: Array<Record<string, { gt: number }>>;
  };
  orderBy: { updatedAt: string };
  take: number;
} | null = null;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookProgress: {
      findMany: async (args: typeof lastArgs) => {
        lastArgs = args;
        return rows.slice(0, args!.take);
      },
    },
  },
}));

const { listReading } = await import("@rawkoon/api/services/books/bookReading");

const row = (overrides: Partial<Row> = {}): Row => ({
  editionId: 1,
  percent: 0.4,
  locator: "epubcfi(/6/4!/2/10)",
  fileId: null,
  positionSecs: null,
  updatedAt: new Date("2026-08-21T10:00:00.000Z"),
  ...overrides,
  edition: {
    kind: "ebook",
    durationSecs: null,
    book: {
      id: 11,
      title: "A Quiet Harbour",
      authors: ["M. Roy"],
      coverUrl: null,
    },
    files: [{ format: "epub", durationSecs: null }],
    ...overrides.edition,
  },
});

describe("listReading", () => {
  it("returns a started ebook with its percent", async () => {
    rows = [row()];

    const [entry] = await listReading("u1", 6);

    expect(entry.edition_id).toBe(1);
    expect(entry.book_id).toBe(11);
    expect(entry.title).toBe("A Quiet Harbour");
    expect(entry.percent).toBe(0.4);
    // Carried so the client can mark the book finished without losing the page.
    expect(entry.locator).toBe("epubcfi(/6/4!/2/10)");
    // An ebook has no clock, and a null here is what tells the widget so.
    expect(entry.position_secs).toBeNull();
    expect(entry.total_duration_secs).toBeNull();
  });

  it("asks the database for unfinished, more-than-opened positions only", async () => {
    rows = [];
    await listReading("u1", 6);

    expect(lastArgs?.where.userId).toBe("u1");
    expect(lastArgs?.where.finishedAt).toBeNull();
    // Newest position first: this list is a "where was I", not a catalogue.
    expect(lastArgs?.orderBy.updatedAt).toBe("desc");
    const thresholds = lastArgs!.where.OR;
    expect(thresholds[0].percent.gt).toBeGreaterThan(0);
    expect(thresholds[1].positionSecs.gt).toBeGreaterThan(0);
  });

  it("skips an ebook edition holding nothing a browser can render", async () => {
    rows = [
      row({
        edition: {
          kind: "ebook",
          durationSecs: null,
          book: { id: 12, title: "Kindle Only", authors: [], coverUrl: null },
          files: [{ format: "azw3", durationSecs: null }],
        },
      }),
    ];

    expect(await listReading("u1", 6)).toEqual([]);
  });

  it("skips an edition whose files are gone", async () => {
    rows = [
      row({
        edition: {
          kind: "ebook",
          durationSecs: null,
          book: { id: 13, title: "Deleted", authors: [], coverUrl: null },
          files: [],
        },
      }),
    ];

    expect(await listReading("u1", 6)).toEqual([]);
  });

  it("keeps an audiobook whose formats no reader could open", async () => {
    rows = [
      row({
        percent: null,
        locator: null,
        fileId: 3,
        positionSecs: 4_200,
        edition: {
          kind: "audiobook",
          durationSecs: 36_000,
          book: { id: 14, title: "Listened", authors: [], coverUrl: null },
          files: [{ format: "m4b", durationSecs: 36_000 }],
        },
      }),
    ];

    const [entry] = await listReading("u1", 6);
    expect(entry.kind).toBe("audiobook");
    expect(entry.file_id).toBe(3);
    expect(entry.position_secs).toBe(4_200);
    expect(entry.total_duration_secs).toBe(36_000);
    expect(entry.percent).toBeNull();
  });

  it("sums file durations when the edition has no total of its own", async () => {
    rows = [
      row({
        percent: null,
        positionSecs: 60,
        edition: {
          kind: "audiobook",
          durationSecs: null,
          book: { id: 15, title: "Split", authors: [], coverUrl: null },
          files: [
            { format: "mp3", durationSecs: 1_800 },
            { format: "mp3", durationSecs: 1_200 },
          ],
        },
      }),
    ];

    const [entry] = await listReading("u1", 6);
    expect(entry.total_duration_secs).toBe(3_000);
  });

  it("stops at the limit after the unopenable rows are dropped", async () => {
    // Two unreadable rows ahead of three readable ones: a limit applied in the
    // query alone would have returned one entry for a limit of two.
    rows = [
      row({
        editionId: 90,
        edition: {
          kind: "ebook",
          durationSecs: null,
          book: { id: 90, title: "Mobi", authors: [], coverUrl: null },
          files: [{ format: "mobi", durationSecs: null }],
        },
      }),
      row({
        editionId: 91,
        edition: {
          kind: "ebook",
          durationSecs: null,
          book: { id: 91, title: "Azw3", authors: [], coverUrl: null },
          files: [{ format: "azw3", durationSecs: null }],
        },
      }),
      row({ editionId: 1 }),
      row({ editionId: 2 }),
      row({ editionId: 3 }),
    ];

    const entries = await listReading("u1", 2);
    expect(entries.map((e) => e.edition_id)).toEqual([1, 2]);
  });
});
