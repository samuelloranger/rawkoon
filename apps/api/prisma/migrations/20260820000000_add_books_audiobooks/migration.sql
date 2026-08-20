-- Books and audiobooks.
--
-- A library_books row is exactly one Google Books volume: a translation and
-- its original are two independent rows, each carrying the title trackers
-- actually use. Publisher printings are not modeled, which is what keeps
-- (book_id, kind) a valid edition key.
--
-- Purely additive. library_media, media_files and quality_profiles are
-- untouched, and the existing download_history partial unique index is left
-- exactly as it was (see the bottom of this file).

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "books_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "download_history" ADD COLUMN     "book_edition_id" INTEGER;

-- AlterTable
ALTER TABLE "media_settings" ADD COLUMN     "audiobook_template" TEXT NOT NULL DEFAULT '{author}/{title} ({year})/{title}',
ADD COLUMN     "audiobooks_library_path" TEXT,
ADD COLUMN     "book_template" TEXT NOT NULL DEFAULT '{author}/{title} ({year})/{title} ({year}) [{format}]',
ADD COLUMN     "books_library_path" TEXT,
ADD COLUMN     "default_book_quality_profile_id" INTEGER;

-- CreateTable
CREATE TABLE "library_books" (
    "id" SERIAL NOT NULL,
    "google_volume_id" TEXT NOT NULL,
    "isbn13" TEXT,
    "title" TEXT NOT NULL,
    "sort_title" TEXT,
    "subtitle" TEXT,
    "overview" TEXT,
    "cover_url" TEXT,
    "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT NOT NULL DEFAULT 'en',
    "published_year" INTEGER,
    "series_name" TEXT,
    "series_position" DOUBLE PRECISION,
    "overrides" JSONB,
    "list_title" TEXT NOT NULL DEFAULT '',
    "list_year" INTEGER,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_editions" (
    "id" SERIAL NOT NULL,
    "book_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'wanted',
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "book_quality_profile_id" INTEGER,
    "narrators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_secs" INTEGER,
    "search_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_grabbed_at" TIMESTAMP(3),
    "total_size_bytes" BIGINT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_files" (
    "id" SERIAL NOT NULL,
    "edition_id" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "format" TEXT NOT NULL,
    "duration_secs" DOUBLE PRECISION,
    "audio_bitrate" INTEGER,
    "audio_codec" TEXT,
    "chapter_count" INTEGER,
    "is_retail" BOOLEAN NOT NULL DEFAULT false,
    "release_group" TEXT,
    "language_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "file_dev" TEXT,
    "file_ino" TEXT,
    "file_mtime_ms" BIGINT,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authors" (
    "id" SERIAL NOT NULL,
    "google_author_name" TEXT NOT NULL,
    "sort_name" TEXT,
    "image_url" TEXT,
    "bio" TEXT,
    "monitored" BOOLEAN NOT NULL DEFAULT false,
    "monitor_from" TIMESTAMP(3),
    "monitor_edition_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "book_quality_profile_id" INTEGER,
    "last_checked_at" TIMESTAMP(3),
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_authors" (
    "id" SERIAL NOT NULL,
    "author_id" INTEGER NOT NULL,
    "book_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'author',

    CONSTRAINT "book_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_quality_profiles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'both',
    "allowed_formats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cutoff_format" TEXT,
    "prefer_retail" BOOLEAN NOT NULL DEFAULT true,
    "max_size_mb" DOUBLE PRECISION,
    "min_seeders" INTEGER NOT NULL DEFAULT 0,
    "min_audio_bitrate" INTEGER,
    "preferred_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prioritized_trackers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prefer_tracker_over_quality" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_quality_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_quality_profile_custom_formats" (
    "id" SERIAL NOT NULL,
    "book_quality_profile_id" INTEGER NOT NULL,
    "custom_format_id" INTEGER NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "forbidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "book_quality_profile_custom_formats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "library_books_google_volume_id_key" ON "library_books"("google_volume_id");

-- CreateIndex
CREATE INDEX "ix_library_books_added_at" ON "library_books"("added_at");

-- CreateIndex
CREATE INDEX "ix_library_books_list_title" ON "library_books"("list_title");

-- CreateIndex
CREATE INDEX "ix_library_books_list_year" ON "library_books"("list_year");

-- CreateIndex
CREATE INDEX "ix_library_books_language" ON "library_books"("language");

-- CreateIndex
CREATE INDEX "ix_library_books_title_trgm" ON "library_books" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_library_books_authors" ON "library_books" USING GIN ("authors");

-- CreateIndex
CREATE INDEX "ix_book_editions_status" ON "book_editions"("status");

-- CreateIndex
CREATE INDEX "ix_book_editions_monitored" ON "book_editions"("monitored");

-- CreateIndex
CREATE INDEX "ix_book_editions_quality_profile_id" ON "book_editions"("book_quality_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_editions_book_kind" ON "book_editions"("book_id", "kind");

-- CreateIndex
CREATE INDEX "ix_book_files_edition_id" ON "book_files"("edition_id");

-- CreateIndex
CREATE INDEX "ix_book_files_file_path" ON "book_files"("file_path");

-- CreateIndex
CREATE INDEX "ix_book_files_file_dev_ino" ON "book_files"("file_dev", "file_ino");

-- CreateIndex
CREATE UNIQUE INDEX "authors_google_author_name_key" ON "authors"("google_author_name");

-- CreateIndex
CREATE INDEX "ix_authors_monitored" ON "authors"("monitored");

-- CreateIndex
CREATE INDEX "ix_book_authors_book_id" ON "book_authors"("book_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_authors_author_book_role" ON "book_authors"("author_id", "book_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "book_quality_profiles_name_key" ON "book_quality_profiles"("name");

-- CreateIndex
CREATE INDEX "ix_bqp_custom_format_profile" ON "book_quality_profile_custom_formats"("book_quality_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bqp_custom_format" ON "book_quality_profile_custom_formats"("book_quality_profile_id", "custom_format_id");

-- CreateIndex
CREATE INDEX "ix_download_history_book_edition_id" ON "download_history"("book_edition_id");

-- AddForeignKey
ALTER TABLE "download_history" ADD CONSTRAINT "download_history_book_edition_id_fkey" FOREIGN KEY ("book_edition_id") REFERENCES "book_editions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_settings" ADD CONSTRAINT "media_settings_default_book_quality_profile_id_fkey" FOREIGN KEY ("default_book_quality_profile_id") REFERENCES "book_quality_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_editions" ADD CONSTRAINT "book_editions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_editions" ADD CONSTRAINT "book_editions_book_quality_profile_id_fkey" FOREIGN KEY ("book_quality_profile_id") REFERENCES "book_quality_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "book_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authors" ADD CONSTRAINT "authors_book_quality_profile_id_fkey" FOREIGN KEY ("book_quality_profile_id") REFERENCES "book_quality_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_quality_profile_custom_formats" ADD CONSTRAINT "book_quality_profile_custom_formats_book_quality_profile_i_fkey" FOREIGN KEY ("book_quality_profile_id") REFERENCES "book_quality_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_quality_profile_custom_formats" ADD CONSTRAINT "book_quality_profile_custom_formats_custom_format_id_fkey" FOREIGN KEY ("custom_format_id") REFERENCES "custom_formats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written: constraints and triggers Prisma cannot express
-- ─────────────────────────────────────────────────────────────────────────────

-- A download_history row is either a media grab or a book grab, never both.
-- NOT "exactly one": both FKs are ON DELETE SET NULL, so deleting the target
-- legitimately leaves a row with both columns null. Requiring exactly one
-- would make that delete fail.
ALTER TABLE "download_history"
  DROP CONSTRAINT IF EXISTS "ck_download_history_single_target";
ALTER TABLE "download_history"
  ADD CONSTRAINT "ck_download_history_single_target"
  CHECK (NOT ("media_id" IS NOT NULL AND "book_edition_id" IS NOT NULL));

-- At most one ACTIVE grab per book edition. This is a SECOND partial unique
-- index, DISJOINT from the existing media one:
--
--   existing: UNIQUE (media_id, COALESCE(episode_id,-1), COALESCE(season,-1))
--               WHERE completed_at IS NULL AND failed = false
--                 AND media_id IS NOT NULL
--
-- Because the predicates cannot both be true for one row, the media index and
-- grabRelease's P2002 race-close keep working verbatim, and the book grab path
-- inherits the same guarantee with no new application logic.
DROP INDEX IF EXISTS "ux_download_history_active_book_target";
CREATE UNIQUE INDEX "ux_download_history_active_book_target"
  ON "download_history" ("book_edition_id")
  WHERE "completed_at" IS NULL
    AND "failed" = false
    AND "book_edition_id" IS NOT NULL;

-- Keep list_title / list_year in sync with title, published_year, overrides.
-- Mirrors library_media_set_list_fields so book and media list sorting behave
-- identically.
CREATE OR REPLACE FUNCTION library_books_set_list_fields() RETURNS trigger AS $$
BEGIN
  IF jsonb_typeof(NEW."overrides"->'title') = 'string' THEN
    NEW."list_title" := NEW."overrides"->>'title';
  ELSE
    NEW."list_title" := NEW."title";
  END IF;
  IF jsonb_typeof(NEW."overrides"->'year') = 'number' THEN
    NEW."list_year" := (NEW."overrides"->>'year')::int;
  ELSE
    NEW."list_year" := NEW."published_year";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_library_books_set_list_fields ON "library_books";
CREATE TRIGGER trg_library_books_set_list_fields
  BEFORE INSERT OR UPDATE OF "title", "published_year", "overrides"
  ON "library_books"
  FOR EACH ROW
  EXECUTE FUNCTION library_books_set_list_fields();

-- library_books.authors is a denormalized cache of book_authors, and holds
-- ONLY role = 'author'. Narrators, translators and illustrators are excluded
-- because this column feeds indexer query building and the reject filter's
-- author-surname check — a translator's name there would poison both.
CREATE OR REPLACE FUNCTION refresh_library_book_authors(p_book_id INT) RETURNS void AS $$
BEGIN
  IF p_book_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE "library_books" lb
  SET "authors" = COALESCE((
    SELECT array_agg(a."google_author_name" ORDER BY a."google_author_name")
    FROM "book_authors" ba
    JOIN "authors" a ON a."id" = ba."author_id"
    WHERE ba."book_id" = p_book_id AND ba."role" = 'author'
  ), ARRAY[]::text[])
  WHERE lb."id" = p_book_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION book_authors_sync_cache() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_library_book_authors(OLD."book_id");
    RETURN OLD;
  END IF;
  PERFORM refresh_library_book_authors(NEW."book_id");
  IF TG_OP = 'UPDATE' AND OLD."book_id" IS DISTINCT FROM NEW."book_id" THEN
    PERFORM refresh_library_book_authors(OLD."book_id");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_book_authors_sync_cache ON "book_authors";
CREATE TRIGGER trg_book_authors_sync_cache
  AFTER INSERT OR UPDATE OR DELETE
  ON "book_authors"
  FOR EACH ROW
  EXECUTE FUNCTION book_authors_sync_cache();

-- book_editions.total_size_bytes and duration_secs aggregate their files.
-- 0 is stored as NULL so "no files" sorts apart from "empty files", matching
-- library_media.total_size_bytes.
CREATE OR REPLACE FUNCTION refresh_book_edition_totals(p_edition_id INT) RETURNS void AS $$
BEGIN
  IF p_edition_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE "book_editions" be
  SET
    "total_size_bytes" = NULLIF(COALESCE((
      SELECT SUM(bf."size_bytes") FROM "book_files" bf
      WHERE bf."edition_id" = p_edition_id
    ), 0), 0),
    "duration_secs" = (
      SELECT NULLIF(ROUND(COALESCE(SUM(bf."duration_secs"), 0))::int, 0)
      FROM "book_files" bf
      WHERE bf."edition_id" = p_edition_id
    )
  WHERE be."id" = p_edition_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION book_files_sync_totals() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_book_edition_totals(OLD."edition_id");
    RETURN OLD;
  END IF;
  PERFORM refresh_book_edition_totals(NEW."edition_id");
  IF TG_OP = 'UPDATE' AND OLD."edition_id" IS DISTINCT FROM NEW."edition_id" THEN
    PERFORM refresh_book_edition_totals(OLD."edition_id");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_book_files_sync_totals ON "book_files";
CREATE TRIGGER trg_book_files_sync_totals
  AFTER INSERT OR UPDATE OR DELETE
  ON "book_files"
  FOR EACH ROW
  EXECUTE FUNCTION book_files_sync_totals();

-- book_editions.last_grabbed_at mirrors library_media.last_grabbed_at.
CREATE OR REPLACE FUNCTION refresh_book_edition_last_grabbed(p_edition_id INT) RETURNS void AS $$
BEGIN
  IF p_edition_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE "book_editions" be
  SET "last_grabbed_at" = (
    SELECT MAX(dh."grabbed_at") FROM "download_history" dh
    WHERE dh."book_edition_id" = p_edition_id
  )
  WHERE be."id" = p_edition_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION download_history_sync_book_edition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_book_edition_last_grabbed(OLD."book_edition_id");
    RETURN OLD;
  END IF;
  PERFORM refresh_book_edition_last_grabbed(NEW."book_edition_id");
  IF TG_OP = 'UPDATE' AND OLD."book_edition_id" IS DISTINCT FROM NEW."book_edition_id" THEN
    PERFORM refresh_book_edition_last_grabbed(OLD."book_edition_id");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_download_history_sync_book_edition ON "download_history";
CREATE TRIGGER trg_download_history_sync_book_edition
  AFTER INSERT OR UPDATE OF "book_edition_id", "grabbed_at" OR DELETE
  ON "download_history"
  FOR EACH ROW
  EXECUTE FUNCTION download_history_sync_book_edition();

-- Seeded default profiles. Format order encodes real preference: m4b is one
-- file with chapters, mp3 is a directory of tracks; epub outranks a pdf scan.
INSERT INTO "book_quality_profiles"
  ("name", "kind", "allowed_formats", "cutoff_format", "prefer_retail", "min_seeders", "updated_at")
VALUES
  ('Standard Ebook', 'ebook', ARRAY['epub','azw3','mobi','pdf'], 'epub', true, 1, CURRENT_TIMESTAMP),
  ('Standard Audiobook', 'audiobook', ARRAY['m4b','mp3','flac','ogg'], 'm4b', true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
