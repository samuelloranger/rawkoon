-- A shelf's uploaded cover: the file name under the image storage, served at
-- /api/shelves/covers/<file>. Null for the mosaic and backdrop covers.
ALTER TABLE "shelves" ADD COLUMN "cover_file" TEXT;
