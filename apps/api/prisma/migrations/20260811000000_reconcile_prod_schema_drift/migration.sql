-- Reconcile schema drift between long-lived databases and the migration history.
--
-- Context: instances that predate the reelward -> rawkoon rename had their
-- schema built by the old migration chain and then had 0_init marked as applied
-- by the baseline fallback in entrypoint.sh, without its body ever running. Any
-- object 0_init introduced that the old chain lacked is therefore missing on
-- those databases, while a few objects created by hand are present there and
-- nowhere else. This migration converges both directions.
--
-- Every statement is idempotent (IF [NOT] EXISTS) because it must be a no-op on
-- a fresh install, correct on a drifted one, and safe to re-run.
--
-- Verified against a copy of a real drifted production database AND a fresh
-- `migrate deploy` before shipping: a failure here blocks container startup,
-- since entrypoint.sh runs migrate deploy on every boot.

-- ---------------------------------------------------------------------------
-- 1. ba_api_keys: unique key name
-- ---------------------------------------------------------------------------
-- Declared by 0_init and by schema.prisma (@@unique([name])), missing on
-- drifted databases.
--
-- Duplicates must be reconciled first. IF NOT EXISTS does not make
-- CREATE UNIQUE INDEX tolerate duplicate data, and duplicates are reachable on
-- exactly the databases this migration targets: POST /api/admin/api-keys checks
-- for a name collision with findFirst and then creates, so with the index
-- absent, two concurrent requests — or any two requests at all — can persist
-- the same name. Leaving that unhandled would fail the migration and, because
-- entrypoint.sh runs migrate deploy on boot, refuse to start the container.
--
-- Duplicates are RENAMED, never deleted: an API key is a live credential, and
-- dropping one would silently break whatever integration holds it. The id is a
-- uuid, so appending it is deterministic and collision-free; the loop is a
-- belt-and-braces guard in case a suffixed name somehow collides with an
-- existing literal name. NULL names are left alone — btree uniques treat NULLs
-- as distinct, so any number of them coexist.
DO $$
DECLARE
  renamed INT;
  passes INT := 0;
BEGIN
  LOOP
    UPDATE "ba_api_keys" a
    SET "name" = a."name" || ' (#' || a."id" || ')'
    WHERE a."name" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "ba_api_keys" b
        WHERE b."name" = a."name" AND b."id" < a."id"
      );
    GET DIAGNOSTICS renamed = ROW_COUNT;
    EXIT WHEN renamed = 0;
    RAISE NOTICE 'Renamed % duplicate API key name(s) to satisfy ba_api_keys_name_key', renamed;
    passes := passes + 1;
    IF passes > 5 THEN
      RAISE EXCEPTION
        'Could not make ba_api_keys.name unique after % passes. Resolve the remaining duplicates by hand (SELECT name, count(*) FROM ba_api_keys WHERE name IS NOT NULL GROUP BY name HAVING count(*) > 1) and re-run the migration.', passes;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ba_api_keys_name_key"
  ON "ba_api_keys"("name");

-- ---------------------------------------------------------------------------
-- 2. invitations: replace UNIQUE(email, status) with a partial unique
-- ---------------------------------------------------------------------------
-- 0_init declared UNIQUE(email, status). That constraint is wrong for the
-- domain: it forbids a second *revoked* (or *accepted*) invitation for the same
-- address, which is ordinary history — an admin may invite, revoke, invite and
-- revoke the same person repeatedly. Production had already accumulated two
-- revoked rows for one email, so creating the constraint there would fail and
-- take the container down on boot.
--
-- The invariant the application actually wants is "at most one PENDING
-- invitation per email": POST /api/admin/invitations pre-checks for a live
-- pending invite and additionally catches P2002 to report
-- "a pending invitation already exists". A partial unique index expresses
-- exactly that, and is strictly more permissive than UNIQUE(email, status) —
-- it introduces no failure mode the old constraint did not already have.
DROP INDEX IF EXISTS "ix_invitations_email_status";

-- Defensive: collapse any pre-existing duplicate pending invitations before
-- creating the index, keeping the newest (its token is the one an admin most
-- recently sent). No-op on a database that has none, including production.
UPDATE "invitations" i
SET "status" = 'revoked'
WHERE i."status" = 'pending'
  AND i."id" < (
    SELECT MAX(j."id") FROM "invitations" j
    WHERE j."email" = i."email" AND j."status" = 'pending'
  );

CREATE UNIQUE INDEX IF NOT EXISTS "ix_invitations_email_pending"
  ON "invitations"("email")
  WHERE "status" = 'pending';

-- Lookups are always by email (+ status); this existed only on one production
-- database. Now declared in schema.prisma so it stops reading as drift.
CREATE INDEX IF NOT EXISTS "ix_invitations_email"
  ON "invitations"("email");

-- ---------------------------------------------------------------------------
-- 3. library_attention_alerts: the open-alert dedupe guard
-- ---------------------------------------------------------------------------
-- This partial unique index enforces the "one open row per (media, scope,
-- kind)" rule that schema.prisma documents in a comment. libraryAttentionSync's
-- upsert loop depends on it — it catches P2002 and falls back to find + update
-- with the comment "Race condition". It was created by hand on one production
-- database and was missing from every fresh install, so those installs could
-- accumulate duplicate open alerts under concurrent syncs.
--
-- COALESCE because NULLs are distinct in a btree unique index: without it, two
-- movie-scope alerts (episode_id IS NULL) for the same media would both be
-- allowed.
--
-- Resolve any existing duplicates first, otherwise index creation fails on a
-- database that has already accumulated them. Keeping the lowest id preserves
-- the original detection; the rest are marked resolved_auto, the same status
-- the sync uses when an alert stops applying.
UPDATE "library_attention_alerts" a
SET "status" = 'resolved_auto', "resolved_at" = COALESCE(a."resolved_at", now())
WHERE a."status" = 'open'
  AND a."id" > (
    SELECT MIN(b."id") FROM "library_attention_alerts" b
    WHERE b."status" = 'open'
      AND b."media_id" = a."media_id"
      AND b."kind" = a."kind"
      AND b."scope_type" = a."scope_type"
      AND COALESCE(b."episode_id", -1) = COALESCE(a."episode_id", -1)
      AND COALESCE(b."season", -1) = COALESCE(a."season", -1)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "library_attention_alert_open_dedupe"
  ON "library_attention_alerts"(
    "media_id",
    "kind",
    "scope_type",
    (COALESCE("episode_id", -1)),
    (COALESCE("season", -1))
  )
  WHERE "status" = 'open';

-- ---------------------------------------------------------------------------
-- 4. notifications: drop a redundant hand-made index
-- ---------------------------------------------------------------------------
-- (user_id, read, created_at DESC) existed only on one production database and
-- is superseded by the narrower (user_id, read) and (user_id, created_at DESC)
-- pair from 20260810120000_query_performance, which the planner measurably
-- preferred over it. Unlike the partial indexes above this one IS visible to
-- Prisma, so leaving it would surface as drift on the next `migrate dev`.
DROP INDEX IF EXISTS "ix_notifications_user_id_read_created_at";
