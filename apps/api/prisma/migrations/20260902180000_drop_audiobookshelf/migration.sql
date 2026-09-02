-- Playback and reading now live in the web and iOS clients. The deep-link
-- settings are unused.
ALTER TABLE "media_settings" DROP COLUMN IF EXISTS "audiobookshelf_url";
ALTER TABLE "media_settings" DROP COLUMN IF EXISTS "audiobookshelf_audiobook_library_id";
ALTER TABLE "media_settings" DROP COLUMN IF EXISTS "audiobookshelf_ebook_library_id";
