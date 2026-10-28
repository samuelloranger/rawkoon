import { beforeEach, describe, expect, it, mock } from "bun:test";

// An upgrade grab must not read like a first grab of a book already owned.

const state: {
  locale: string;
  notifications: Array<{
    title: string;
    body: string;
    metadata: Record<string, unknown> | undefined;
  }>;
} = { locale: "en", notifications: [] };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookEdition: {
      findUnique: async () => ({
        kind: "audiobook",
        book: {
          id: 9,
          title: "The Example",
          publishedYear: 2024,
          authors: ["A. Writer"],
          coverUrl: null,
        },
      }),
    },
    user: {
      findMany: async () => [
        { id: "admin-1", locale: state.locale, notificationPreferences: null },
      ],
    },
  },
}));

mock.module("@rawkoon/api/workers/notificationService", () => ({
  getAllUsers: () => Promise.resolve([]),
  createAndQueueNotification: async (
    _userId: string,
    title: string,
    body: string,
    _type: string,
    _url?: string,
    metadata?: Record<string, unknown>,
  ) => {
    state.notifications.push({ title, body, metadata });
    return true;
  },
}));

const {
  notifyAdminsBookGrabbed,
  notifyAdminsBookDownloaded,
  notifyAdminsBookImportFailed,
} = await import("@rawkoon/api/workers/notifyBookEvents");

describe("book notifications", () => {
  beforeEach(() => {
    state.locale = "en";
    state.notifications = [];
  });

  it("keeps the plain wording for a first grab", async () => {
    await notifyAdminsBookGrabbed(1, "Some.Release.M4B");

    expect(state.notifications[0]?.title).toBe("Audiobook grabbed");
    expect(state.notifications[0]?.metadata).toEqual({
      book_id: 9,
      is_upgrade: false,
      subject: "The Example",
      detail: "Some.Release.M4B",
    });
  });

  it("labels an upgrade grab as an upgrade", async () => {
    await notifyAdminsBookGrabbed(1, "Some.Release.M4B", true);

    expect(state.notifications[0]?.title).toBe("Audiobook upgrade grabbed");
    expect(state.notifications[0]?.body).toBe(
      "The Example (2024) by A. Writer — Some.Release.M4B",
    );
    expect(state.notifications[0]?.metadata?.is_upgrade).toBe(true);
  });

  it("labels an upgrade grab in French", async () => {
    state.locale = "fr";
    await notifyAdminsBookGrabbed(1, "Some.Release.M4B", true);

    expect(state.notifications[0]?.title).toBe(
      "Mise à niveau Livre audio saisie",
    );
  });

  it("says upgraded, not downloaded, when an upgrade imports", async () => {
    await notifyAdminsBookDownloaded(1, true);

    expect(state.notifications[0]?.title).toBe("Audiobook upgraded");
    expect(state.notifications[0]?.body).toBe(
      "The Example (2024) by A. Writer: the better copy is now in your library.",
    );
  });

  it("keeps the plain failure wording for a first grab", async () => {
    await notifyAdminsBookImportFailed(1, "stalled - no progress");

    expect(state.notifications[0]?.title).toBe("Audiobook import failed");
    expect(state.notifications[0]?.body).toBe(
      "The Example (2024) by A. Writer: stalled - no progress",
    );
  });

  it("says the book is still there when an upgrade fails", async () => {
    await notifyAdminsBookImportFailed(1, "stalled - no progress", true);

    expect(state.notifications[0]?.title).toBe("Audiobook upgrade failed");
    expect(state.notifications[0]?.body).toBe(
      "The Example (2024) by A. Writer: stalled - no progress. The book is still in your library.",
    );
  });
});
