-- The in-app player and reader are gone; Audiobookshelf owns playback,
-- reading and their progress. The tables that backed them are dropped rather
-- than left orphaned. Progress is not migrated: Audiobookshelf tracks its own
-- from scratch, and there is no shared key to map onto.
DROP TABLE IF EXISTS "book_progress";
DROP TABLE IF EXISTS "book_file_chapters";
ALTER TABLE "book_files" DROP COLUMN IF EXISTS "chapter_count";
