-- The 1.6.1 build ran on Bun 1.3.11, which clamps any inode above 2^63 to
-- INT64_MAX instead of reporting it. Every file on a pooled filesystem
-- (mergerfs and friends) therefore persisted the *same* value.
--
-- Left in place, those rows are trusted verbatim by buildLibraryInodeKeySet:
-- they are non-null, so they are never re-statted, and their key can never
-- match a correctly-normalized live inode. Hardlinked downloads would show as
-- not imported, and every poisoned file would collide with every other.
--
-- Clearing them makes the next scan re-stat and write the real value.
UPDATE "media_files"
SET "file_dev" = NULL, "file_ino" = NULL
WHERE "file_ino" IN ('9223372036854775807', '0');
