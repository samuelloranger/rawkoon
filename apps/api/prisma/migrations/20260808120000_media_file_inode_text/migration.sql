-- dev/ino are identity keys, never numbers. mergerfs synthesizes unsigned
-- 64-bit inodes that overflow a signed bigint, which aborted every rescan
-- with "value 9223372036854775808 is out of range for type bigint".
DROP INDEX IF EXISTS "ix_media_files_file_dev_ino";

ALTER TABLE "media_files"
  ALTER COLUMN "file_dev" TYPE text USING "file_dev"::text,
  ALTER COLUMN "file_ino" TYPE text USING "file_ino"::text;

-- Every pre-existing value went through the lossy BigInt(Math.trunc(number))
-- path, so it is an approximation with float rounding baked in. Two files
-- whose inodes rounded together would look like hardlinks to downloadsScanner.
-- Discard them; the next scan writes exact values through the existing
-- backfill branch in rescan.ts.
UPDATE "media_files" SET "file_dev" = NULL, "file_ino" = NULL;

CREATE INDEX "ix_media_files_file_dev_ino" ON "media_files" ("file_dev", "file_ino");
