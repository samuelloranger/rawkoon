import { beforeEach, describe, expect, it, mock } from "bun:test";
import { dbModule } from "./mocks/prisma";

const findUnique = mock(async (..._: unknown[]) => null as unknown);
const findMany = mock(async (..._: unknown[]) => [] as unknown[]);
mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      libraryBook: { findUnique },
      downloadHistory: { findMany },
    },
  }),
);

const deleteLibraryBookWithRequests = mock(async (_id: number) => {});
mock.module("@rawkoon/api/services/mediaRequests", () => ({
  deleteLibraryBookWithRequests,
}));
mock.module("@rawkoon/api/services/seeding/seedSweep", () => ({
  abandonPendingDownloads: async () => {},
}));

const logActivity = mock(async (_input: unknown): Promise<void> => {});
mock.module("@rawkoon/api/utils/activityLogs", () => ({ logActivity }));

const { removeBook } = await import(
  "@rawkoon/api/services/books/bookListQueries"
);

const book = {
  id: 3,
  title: "Some Book",
  publishedYear: 2011,
};

describe("removeBook activity log", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockImplementation(async () => book);
    deleteLibraryBookWithRequests.mockClear();
    logActivity.mockReset();
    logActivity.mockImplementation(async () => {});
  });

  it("logs a book_deleted entry with the acting user", async () => {
    expect(await removeBook(3, "admin-1")).toBe(true);

    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0]?.[0]).toEqual({
      type: "book_deleted",
      userId: "admin-1",
      payload: {
        book_id: 3,
        title: "Some Book",
        year: 2011,
      },
    });
  });

  it("logs nothing when the book does not exist", async () => {
    findUnique.mockImplementation(async () => null);

    expect(await removeBook(3, "admin-1")).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("still succeeds when logActivity rejects", async () => {
    logActivity.mockImplementation(async () => {
      throw new Error("queue down");
    });

    expect(await removeBook(3, "admin-1")).toBe(true);
    expect(deleteLibraryBookWithRequests).toHaveBeenCalledWith(3);
  });
});
