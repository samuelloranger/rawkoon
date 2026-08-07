-- Persist filesystem identity so MediaInfo rescans / inode hardlink checks can
-- skip unchanged files without re-statting every path.

ALTER TABLE "media_files" ADD COLUMN IF NOT EXISTS "file_dev" BIGINT;
ALTER TABLE "media_files" ADD COLUMN IF NOT EXISTS "file_ino" BIGINT;
ALTER TABLE "media_files" ADD COLUMN IF NOT EXISTS "file_mtime_ms" BIGINT;

CREATE INDEX IF NOT EXISTS "ix_media_files_file_dev_ino"
  ON "media_files"("file_dev", "file_ino");
