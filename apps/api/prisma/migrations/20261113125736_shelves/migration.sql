-- CreateTable
CREATE TABLE "shelves" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order_mode" TEXT NOT NULL DEFAULT 'manual',
    "cover_style" TEXT NOT NULL DEFAULT 'mosaic',
    "cover_tmdb_id" INTEGER,
    "cover_type" TEXT,
    "home_row" BOOLEAN NOT NULL DEFAULT false,
    "visible_from" TEXT,
    "visible_to" TEXT,
    "seed_key" TEXT,
    "rules" JSONB,
    "auto_join" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelf_entries" (
    "id" SERIAL NOT NULL,
    "shelf_id" INTEGER NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "season" INTEGER,
    "position" INTEGER NOT NULL,
    "group_label" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "poster_path" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shelf_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shelf_entries_shelf_id_position_idx" ON "shelf_entries"("shelf_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "shelf_entries_shelf_id_tmdb_id_type_season_key" ON "shelf_entries"("shelf_id", "tmdb_id", "type", "season");

-- AddForeignKey
ALTER TABLE "shelf_entries" ADD CONSTRAINT "shelf_entries_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "shelves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
