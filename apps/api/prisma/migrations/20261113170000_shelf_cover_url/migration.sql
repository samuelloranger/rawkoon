-- A backdrop cover can name the exact image an administrator picked (a TMDB
-- backdrop), instead of the cover title's first one.
ALTER TABLE "shelves" ADD COLUMN "cover_url" TEXT;
