-- Per-author language filter for monitored authors.
-- Empty array means "any language", which is what every existing row gets.
ALTER TABLE "authors"
  ADD COLUMN IF NOT EXISTS "monitor_languages" TEXT[] NOT NULL DEFAULT '{}';
