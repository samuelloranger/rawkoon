import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { Activity } from "@rawkoon/shared/types";
import { getActivityPresentation } from "./activityPresentation";

// Echo the key and options so assertions don't depend on locale copy.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts
    ? `${key}|${JSON.stringify(opts)}`
    : key) as unknown as TFunction<"common">;

const base: Activity = {
  completed_at: "2026-01-01T00:00:00.000Z",
  username: "Admin",
  service: "library",
};

describe("getActivityPresentation deletions", () => {
  it("renders a media delete that kept the files, with a year", () => {
    const p = getActivityPresentation(
      {
        ...base,
        type: "media_deleted",
        title: "Name",
        year: 2001,
        delete_files: false,
      },
      t,
      "en",
    );
    expect(p?.description).toBe(
      'dashboard.activity.mediaDeleted|{"user":"Admin","title":"Name (2001)"}',
    );
    expect(p?.service).toBe("library");
  });

  it("omits the year when absent", () => {
    const p = getActivityPresentation(
      { ...base, type: "media_deleted", title: "Name" },
      t,
      "en",
    );
    expect(p?.description).toContain('"title":"Name"');
    expect(p?.description).not.toContain("(");
  });

  it("renders a media delete that removed files with the count", () => {
    const p = getActivityPresentation(
      {
        ...base,
        type: "media_deleted",
        title: "Name",
        delete_files: true,
        files_removed: 3,
      },
      t,
      "en",
    );
    expect(p?.description).toBe(
      'dashboard.activity.mediaDeletedWithFiles|{"user":"Admin","title":"Name","count":3}',
    );
  });

  it("renders a book delete", () => {
    const p = getActivityPresentation(
      { ...base, type: "book_deleted", title: "Book", year: 2010 },
      t,
      "en",
    );
    expect(p?.description).toBe(
      'dashboard.activity.bookDeleted|{"user":"Admin","title":"Book (2010)"}',
    );
  });
});
