import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const sent: Array<{ userId: string; title: string; options: unknown }> = [];
let failFor: string | null = null;

mock.module(
  "@rawkoon/api/services/notification/notificationPreferences",
  () => ({
    getAdminNotificationTargets: async () => [
      { id: "a1", locale: "en" },
      { id: "a2", locale: "fr" },
      { id: "a3", locale: "en" },
    ],
  }),
);
mock.module("@rawkoon/api/workers/notificationService", () => ({
  createAndQueueNotification: async (
    userId: string,
    title: string,
    _body: string,
    _type: string,
    _url?: string,
    _metadata?: unknown,
    _imageUrl?: string,
    options?: unknown,
  ) => {
    if (userId === failFor) throw new Error("boom");
    sent.push({ userId, title, options });
    return true;
  },
}));

const { notifyAdmins } = await import(
  "@rawkoon/api/services/notification/notifyAdmins"
);

describe("notifyAdmins", () => {
  beforeEach(() => {
    sent.length = 0;
    failFor = null;
  });

  it("builds copy per admin locale and passes the preference key through", async () => {
    await notifyAdmins({
      build: (locale) => ({ title: `t-${locale}`, body: "b" }),
      type: "x",
      preferenceKey: "library_failed",
    });
    expect(sent.map((s) => s.title)).toEqual(["t-en", "t-fr", "t-en"]);
    expect(sent[0].options).toMatchObject({ preferenceKey: "library_failed" });
  });

  it("one admin failing does not block the others", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    failFor = "a1";
    await notifyAdmins({
      build: () => ({ title: "t", body: "b" }),
      type: "x",
      preferenceKey: "library_failed",
    });
    expect(sent.map((s) => s.userId)).toEqual(["a2", "a3"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a throwing copy builder for one locale does not block the others", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await notifyAdmins({
      build: (locale) => {
        if (locale === "fr") throw new Error("bad copy");
        return { title: "t", body: "b" };
      },
      type: "x",
      preferenceKey: "library_failed",
    });
    expect(sent.map((s) => s.userId)).toEqual(["a1", "a3"]);
    warn.mockRestore();
  });
});
