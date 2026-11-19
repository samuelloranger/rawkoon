/**
 * Dump the database before `prisma migrate deploy` applies pending migrations.
 * Run by entrypoint.sh; a non-zero exit means "do not migrate".
 *
 * Env: DATABASE_URL (required), DB_BACKUP_BEFORE_MIGRATE (default true),
 * DB_BACKUP_DIR (default /app/data/backups), DB_BACKUP_KEEP (default 3),
 * APP_VERSION (only used in the file name).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

const FILE_PREFIX = "rawkoon-pre-migrate-";
const BACKUP_FILE = /^rawkoon-pre-migrate-(\d{8}T\d{6}Z)-.+\.dump$/;

export type BackupConfig = { enabled: boolean; dir: string; keep: number };

export function parseConfig(
  env: Record<string, string | undefined>,
): BackupConfig {
  const flag = (env.DB_BACKUP_BEFORE_MIGRATE ?? "true").trim().toLowerCase();
  if (flag !== "true" && flag !== "false") {
    throw new Error(
      `DB_BACKUP_BEFORE_MIGRATE must be "true" or "false", got "${flag}"`,
    );
  }
  const keepRaw = (env.DB_BACKUP_KEEP ?? "3").trim();
  if (!/^[1-9]\d*$/.test(keepRaw)) {
    throw new Error(
      `DB_BACKUP_KEEP must be a positive integer, got "${keepRaw}"`,
    );
  }
  return {
    enabled: flag === "true",
    dir: env.DB_BACKUP_DIR?.trim() || "/app/data/backups",
    keep: Number(keepRaw),
  };
}

export function pendingMigrations(
  onDisk: string[],
  applied: string[],
): string[] {
  const done = new Set(applied);
  return onDisk.filter((name) => !done.has(name)).sort();
}

export function backupFileName(now: Date, version: string): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const safeVersion = version.replace(/[^A-Za-z0-9._+-]/g, "_") || "unknown";
  return `${FILE_PREFIX}${stamp}-${safeVersion}.dump`;
}

/** Names to delete so only the newest `keep` pre-migrate dumps remain. */
export function backupsToDelete(files: string[], keep: number): string[] {
  return files
    .filter((f) => BACKUP_FILE.test(f))
    .sort((a, b) =>
      BACKUP_FILE.exec(b)![1].localeCompare(BACKUP_FILE.exec(a)![1]),
    )
    .slice(keep);
}

/** libpq env vars from a Prisma-style URL, so the password never lands in argv or logs. */
export function pgEnvFromUrl(databaseUrl: string): Record<string, string> {
  // WHATWG URL rejects credentials with an empty host, which is exactly the socket form.
  const emptyAuthorityHost = /^[a-z]+:\/\/[^/?]*@(?=[/?])/i.test(databaseUrl);
  const url = new URL(
    emptyAuthorityHost
      ? databaseUrl.replace(/@(?=[/?])/, "@localhost")
      : databaseUrl,
  );
  const emptyHost = emptyAuthorityHost || url.hostname === "";
  // Socket URLs carry the host (a socket dir) in ?host= and leave the authority empty.
  const host =
    url.searchParams.get("host") ||
    (emptyHost ? "" : decodeURIComponent(url.hostname)).replace(
      /^\[(.*)\]$/,
      "$1",
    );
  const env: Record<string, string> = {
    PGHOST: host,
    PGPORT: url.port || url.searchParams.get("port") || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  const schema = url.searchParams.get("schema");
  if (schema) {
    // Falling back to the default schema would make a populated database look empty.
    if (!/^[A-Za-z0-9_]+$/.test(schema))
      throw new Error(`unsupported schema name in DATABASE_URL: "${schema}"`);
    env.PGOPTIONS = `-c search_path=${schema}`;
  }
  return env;
}

function run(cmd: string, args: string[], pgEnv: Record<string, string>) {
  const res = spawnSync(cmd, args, {
    env: { ...process.env, ...pgEnv },
    encoding: "utf8",
  });
  if (res.error) throw new Error(`${cmd} could not run: ${res.error.message}`);
  if (res.status !== 0)
    throw new Error(`${cmd} exited ${res.status}: ${res.stderr.trim()}`);
  return res.stdout.trim();
}

function main(): void {
  const config = parseConfig(process.env);
  if (!config.enabled) {
    console.log(
      "Pre-migration backup disabled (DB_BACKUP_BEFORE_MIGRATE=false).",
    );
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const pgEnv = pgEnvFromUrl(databaseUrl);

  const psql = (sql: string) =>
    run("psql", ["-tAX", "-v", "ON_ERROR_STOP=1", "-c", sql], pgEnv);
  const hasTable =
    psql("SELECT to_regclass('_prisma_migrations') IS NOT NULL") === "t";
  const userTables = Number(
    psql(
      "SELECT count(*) FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'",
    ),
  );
  const applied = hasTable
    ? psql(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
      )
        .split("\n")
        .filter(Boolean)
    : [];

  // Nothing applied and no tables: a first boot has no data to lose.
  if (applied.length === 0 && userTables === 0) {
    console.log("Empty database: skipping pre-migration backup.");
    return;
  }

  // A failed migration makes every restart retry; dumping each time would rotate out the clean pre-upgrade dump.
  const failed = hasTable
    ? Number(
        psql(
          "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL",
        ),
      )
    : 0;
  if (failed > 0) {
    console.log(
      "A previous migration did not finish: skipping the backup to keep the existing pre-migration dumps.",
    );
    return;
  }

  const migrationsDir = resolve(import.meta.dir, "../../prisma/migrations");
  const onDisk = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        existsSync(join(migrationsDir, d.name, "migration.sql")),
    )
    .map((d) => d.name);
  // An unbaselined existing schema (tables, no history) is migrated by the entrypoint's baseline path.
  const pending = hasTable ? pendingMigrations(onDisk, applied) : onDisk;
  if (pending.length === 0) {
    console.log("No pending migrations: skipping pre-migration backup.");
    return;
  }

  mkdirSync(config.dir, { recursive: true });
  const file = backupFileName(new Date(), process.env.APP_VERSION ?? "unknown");
  const target = join(config.dir, file);
  const partial = `${target}.partial`;
  console.log(
    `${pending.length} pending migration(s). Backing up to ${target}`,
  );
  try {
    run("pg_dump", ["-Fc", "-f", partial], pgEnv);
    renameSync(partial, target);
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  }

  for (const old of backupsToDelete(readdirSync(config.dir), config.keep)) {
    rmSync(join(config.dir, old), { force: true });
    console.log(`Removed old backup ${old}`);
  }
  console.log("Backup complete.");
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.error(
      `ERROR: pre-migration backup failed: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}
