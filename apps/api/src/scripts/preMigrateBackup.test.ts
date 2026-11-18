import { describe, expect, test } from "bun:test";
import {
  backupFileName,
  backupsToDelete,
  parseConfig,
  pendingMigrations,
  pgEnvFromUrl,
} from "./preMigrateBackup";

describe("parseConfig", () => {
  test("defaults", () => {
    expect(parseConfig({})).toEqual({
      enabled: true,
      dir: "/app/data/backups",
      keep: 3,
    });
  });
  test("overrides and disable", () => {
    expect(
      parseConfig({
        DB_BACKUP_BEFORE_MIGRATE: "FALSE",
        DB_BACKUP_DIR: "/b",
        DB_BACKUP_KEEP: "5",
      }),
    ).toEqual({ enabled: false, dir: "/b", keep: 5 });
  });
  test("rejects bad values", () => {
    expect(() => parseConfig({ DB_BACKUP_KEEP: "0" })).toThrow();
    expect(() => parseConfig({ DB_BACKUP_KEEP: "x" })).toThrow();
    expect(() => parseConfig({ DB_BACKUP_BEFORE_MIGRATE: "no" })).toThrow();
  });
});

test("pendingMigrations", () => {
  expect(pendingMigrations(["b", "a", "c"], ["a"])).toEqual(["b", "c"]);
  expect(pendingMigrations(["a"], ["a"])).toEqual([]);
});

test("backupFileName is UTC and filesystem-safe", () => {
  expect(
    backupFileName(new Date("2026-11-18T01:02:03.456Z"), "v1.2.3+1-main.4"),
  ).toBe("rawkoon-pre-migrate-20261118T010203Z-v1.2.3+1-main.4.dump");
  expect(backupFileName(new Date(0), "a/b c")).toContain("-a_b_c.dump");
});

test("backupsToDelete keeps the newest N and ignores other files", () => {
  const files = [
    "rawkoon-pre-migrate-20261101T000000Z-v1.dump",
    "rawkoon-pre-migrate-20261103T000000Z-v1.dump",
    "rawkoon-pre-migrate-20261102T000000Z-v1.dump",
    "rawkoon-pre-migrate-20261104T000000Z-v1.dump",
    "manual.dump",
    "rawkoon-pre-migrate-20261105T000000Z-v1.dump.partial",
  ];
  expect(backupsToDelete(files, 2)).toEqual([
    "rawkoon-pre-migrate-20261102T000000Z-v1.dump",
    "rawkoon-pre-migrate-20261101T000000Z-v1.dump",
  ]);
  expect(backupsToDelete(files, 10)).toEqual([]);
});

test("pgEnvFromUrl decodes credentials and maps prisma params", () => {
  expect(
    pgEnvFromUrl(
      "postgresql://u%40x:p%2Fw@db:5433/app?schema=app&sslmode=require",
    ),
  ).toEqual({
    PGHOST: "db",
    PGPORT: "5433",
    PGUSER: "u@x",
    PGPASSWORD: "p/w",
    PGDATABASE: "app",
    PGSSLMODE: "require",
    PGOPTIONS: "-c search_path=app",
  });
});

test("pgEnvFromUrl refuses a schema it can't pass safely", () => {
  expect(() =>
    pgEnvFromUrl("postgresql://u:p@db:5432/app?schema=my-schema"),
  ).toThrow("unsupported schema name");
});
