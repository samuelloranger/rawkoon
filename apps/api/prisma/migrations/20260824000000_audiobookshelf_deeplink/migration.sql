-- Deep-link settings for the Audiobookshelf hand-off. Nullable: an install
-- without Audiobookshelf simply renders no button.
ALTER TABLE "media_settings"
  ADD COLUMN "audiobookshelf_url" TEXT,
  ADD COLUMN "audiobookshelf_audiobook_library_id" TEXT,
  ADD COLUMN "audiobookshelf_ebook_library_id" TEXT;
