import { describe, expect, it, mock } from "bun:test";

// compareMigrations's module also owns the raw query; stub the client away.
mock.module("@rawkoon/api/db", () => ({ prisma: {} }));

const { compareMigrations } = await import("./migrations");

const finished = (name: string) => ({
  migration_name: name,
  finished_at: new Date("2026-11-01T00:00:00Z"),
  rolled_back_at: null,
});

describe("compareMigrations", () => {
  it("is ok when every shipped migration has a finished row", () => {
    const outcome = compareMigrations(
      [finished("0_init"), finished("20260716000000_add_downloads_path")],
      ["0_init", "20260716000000_add_downloads_path"],
    );
    expect(outcome.status).toBe("ok");
    expect(outcome.summary).toBe("All 2 migrations are applied.");
    expect(outcome.fix).toBeNull();
  });

  it("warns listing migrations that were never applied", () => {
    const outcome = compareMigrations(
      [finished("0_init")],
      [
        "0_init",
        "20260716000000_add_downloads_path",
        "20260725000000_download_client_integration",
      ],
    );
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toContain("2 pending");
    expect(outcome.summary).toContain(
      "20260716000000_add_downloads_path, 20260725000000_download_client_integration",
    );
    expect(outcome.fix).toContain("prisma migrate deploy");
  });

  it("treats a resolved-then-redeployed migration as applied, not rolled back", () => {
    const outcome = compareMigrations(
      [
        // `migrate resolve --rolled-back` keeps the old row…
        {
          migration_name: "0_init",
          finished_at: null,
          rolled_back_at: new Date("2026-11-02T00:00:00Z"),
        },
        // …and the next deploy adds a finished row for the same name.
        finished("0_init"),
        finished("20260716000000_add_downloads_path"),
      ],
      ["0_init", "20260716000000_add_downloads_path"],
    );
    expect(outcome.status).toBe("ok");
    expect(outcome.summary).toBe("All 2 migrations are applied.");
    expect(outcome.fix).toBeNull();
  });

  it("warns on rolled-back and unfinished rows", () => {
    const rolledBack = {
      migration_name: "0_init",
      finished_at: null,
      rolled_back_at: new Date("2026-11-02T00:00:00Z"),
    };
    const unfinished = {
      migration_name: "20260716000000_add_downloads_path",
      finished_at: null,
      rolled_back_at: null,
    };
    const outcome = compareMigrations(
      [finished("x"), rolledBack, unfinished],
      ["x", "0_init", "20260716000000_add_downloads_path"],
    );
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toContain("2 rolled back or unfinished");
    expect(outcome.summary).toContain("0_init");
  });

  it("accepts timestamp columns delivered as strings", () => {
    const row = {
      migration_name: "0_init",
      finished_at: "2026-11-01T00:00:00.000Z",
      rolled_back_at: null,
    };
    expect(compareMigrations([row], ["0_init"]).status).toBe("ok");
  });

  it("is ok with nothing applied yet only when nothing shipped — otherwise pending", () => {
    expect(compareMigrations([], ["0_init"]).status).toBe("warn");
    expect(compareMigrations([], []).status).toBe("ok");
  });
});
