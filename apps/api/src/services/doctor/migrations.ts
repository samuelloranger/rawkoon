import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "@rawkoon/api/db";
import type { CheckOutcome } from "./status";

/** A `_prisma_migrations` row; timestamps arrive as Date (or string) over the wire. */
export interface AppliedMigrationRow {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

const isApplied = (row: AppliedMigrationRow) =>
  row.finished_at !== null && row.rolled_back_at === null;

/**
 * Pure: compares applied rows with the shipped migration directories so the
 * doctor can name exactly which migrations are pending, rolled back, or failed.
 */
export function compareMigrations(
  rows: readonly AppliedMigrationRow[],
  migrationDirs: readonly string[],
): CheckOutcome {
  const finished = new Set(rows.filter(isApplied).map((r) => r.migration_name));
  const pending = migrationDirs.filter((dir) => !finished.has(dir));
  // A `migrate resolve --rolled-back` leaves the old row behind even after a
  // redeploy adds a finished one; a name with a finished row is healthy.
  const rolledBackOrFailed = [
    ...new Set(
      rows
        .filter((row) => !isApplied(row) && !finished.has(row.migration_name))
        .map((row) => row.migration_name),
    ),
  ];

  if (pending.length === 0 && rolledBackOrFailed.length === 0) {
    return {
      status: "ok",
      summary: `All ${migrationDirs.length} migrations are applied.`,
      fix: null,
    };
  }

  const parts: string[] = [];
  if (pending.length > 0) {
    parts.push(`${pending.length} pending (${pending.join(", ")})`);
  }
  if (rolledBackOrFailed.length > 0) {
    parts.push(
      `${rolledBackOrFailed.length} rolled back or unfinished (${rolledBackOrFailed.join(", ")})`,
    );
  }
  return {
    status: "warn",
    summary: `Migrations need attention: ${parts.join("; ")}.`,
    fix: "Run `prisma migrate deploy` — the container entrypoint does this on startup.",
  };
}

// Resolved from this module's own path, not the process cwd, so it is correct
// both in dev (repo checkout) and inside the container image (WORKDIR apps/api).
// Three levels up: URL resolution drops the file name first, so this is
// doctor/ -> services/ -> src/ -> apps/api.
const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../prisma/migrations", import.meta.url),
);

/** Migration directory names shipped with the image, alphabetical. */
export async function readMigrationDirs(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Applied migration rows as Prisma recorded them. */
export async function readAppliedMigrationRows(): Promise<
  AppliedMigrationRow[]
> {
  const rows = await prisma.$queryRaw<AppliedMigrationRow[]>`
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
  `;
  return rows ?? [];
}
