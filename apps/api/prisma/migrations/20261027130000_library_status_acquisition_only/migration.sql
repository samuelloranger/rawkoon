-- library_media.status now tracks acquisition only. A finished show used to be
-- stored as returning / in_production / planned, mirroring tmdb_status; it is
-- now plain 'downloaded' and the airing state is read from tmdb_status.
--
-- A row whose tmdb_status is missing gets the raw TMDB value its old status
-- stood for, so it still reads as airing. Reversible from tmdb_status:
--   'Returning Series' -> returning, 'In Production' -> in_production,
--   'Planned' -> planned, for shows with status 'downloaded'.
-- Idempotent: once rewritten no row matches, so a re-run (or a fresh, empty
-- table) changes nothing. updated_at is left alone on purpose.
UPDATE "library_media"
SET
  "status" = 'downloaded',
  "tmdb_status" = COALESCE(
    "tmdb_status",
    CASE "status"
      WHEN 'returning' THEN 'Returning Series'
      WHEN 'in_production' THEN 'In Production'
      ELSE 'Planned'
    END
  )
WHERE "status" IN ('returning', 'in_production', 'planned');
