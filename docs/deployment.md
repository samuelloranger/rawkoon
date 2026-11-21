# Deployment and recovery

Rawkoon ships as one Docker image containing the API and the built web
application. In production, the API serves the SPA from the same origin; only
one application port needs to be exposed.

## Deploy

Start from <code>docker-compose.prod-example.yml</code>, copy it to
<code>docker-compose.prod.yml</code>, configure <code>.env</code>, and run:

    docker compose -f docker-compose.prod.yml up -d

The image expects PostgreSQL and Valkey (Redis-compatible). Mount these directories from the
example compose file:

- <code>data/</code> for image storage and application file operations.
- <code>vapid_keys/</code> when using file-based web-push keys.
- Your media-library directories at the same paths Rawkoon is configured to
  use.

The container runs as the `bun` user (uid 1000), so the bind-mounted
directories must be owned by it:

    mkdir -p data vapid_keys && sudo chown -R 1000:1000 data vapid_keys

After the first start, run the doctor (see below) to verify the install.

The container applies pending Prisma migrations when it starts
(`entrypoint.sh` runs `bunx prisma migrate deploy`). To apply them
manually without restarting:

    docker compose -f docker-compose.prod.yml exec rawkoon bunx prisma migrate deploy

This manual command skips the pre-migration backup described below.

Do not run `bun run db:migrate` inside the container — that script sources a
repo-root `.env` the image does not ship. Do not run development migration
commands against production.

To update, pull the image and restart the container. Which tag to run
(`:latest`, `:edge` or a pinned `:X.Y.Z`), and why going back from `:edge`
can need a database restore, is covered in
[Updating and release channels](/self-hosting#updating-and-release-channels).

## Automatic backup before migrations

On every start, the entrypoint checks for database migrations that the image
carries but the database has not applied. Only then it runs `pg_dump -Fc` into
`DB_BACKUP_DIR`, named `rawkoon-pre-migrate-<UTC timestamp>-<app version>.dump`,
and keeps the newest `DB_BACKUP_KEEP` dumps. A first boot on an empty database
and a start with nothing pending write no dump.

If the dump fails, the container exits without migrating, so the database stays
as it was. Fix the cause (disk space, permissions, an unreachable database) or
start with `DB_BACKUP_BEFORE_MIGRATE=false` to migrate without a backup.

| Variable | Default | Meaning |
|---|---|---|
| `DB_BACKUP_BEFORE_MIGRATE` | `true` | `false` skips the dump. |
| `DB_BACKUP_DIR` | `/app/data/backups` | Inside the persisted `data/` volume, so dumps survive the container. |
| `DB_BACKUP_KEEP` | `3` | Number of pre-migration dumps to retain. |

The image ships the PostgreSQL 18 client, which dumps 17 and 18 servers. An
older server major is fine; a newer one needs a newer image.

To undo a bad migration, stop the app, restore the dump, then start the image
tag that ran before the upgrade (the dump's file name carries the version it
was taken from):

    docker compose -f docker-compose.prod.yml stop rawkoon
    docker compose -f docker-compose.prod.yml exec -T db sh -c \
      'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
      < data/backups/rawkoon-pre-migrate-<timestamp>-<version>.dump
    # pin the previous image tag in docker-compose.prod.yml, then:
    docker compose -f docker-compose.prod.yml up -d rawkoon

## Back up a complete instance

Keep the following together in a secure backup location:

1. A PostgreSQL dump.
2. <code>data/</code> and, when present, <code>vapid_keys/</code>.
3. All media-library directories.
4. <code>.env</code>, stored separately because it contains credentials.

Stop Rawkoon before copying application files so the database and filesystem
cannot change during the backup. Pause other media writers or use filesystem
snapshots for the media directories.

    backup_dir="backups/rawkoon-$(date +%F)"
    mkdir -p "$backup_dir"
    docker compose -f docker-compose.prod.yml stop rawkoon
    docker compose -f docker-compose.prod.yml exec -T db sh -c \
      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
      > "$backup_dir/rawkoon.dump"
    tar -czf "$backup_dir/data.tar.gz" data
    [ ! -d vapid_keys ] || tar -czf "$backup_dir/vapid-keys.tar.gz" vapid_keys
    docker compose -f docker-compose.prod.yml start rawkoon

Copy the media-library directories and <code>.env</code> separately. Their
locations vary by installation.

## Restore

Restore only into an equivalent deployment, with the same media mounts. Stop
Rawkoon before the recovery:

    backup_dir="/path/to/rawkoon-backup"
    docker compose -f docker-compose.prod.yml stop rawkoon
    tar -xzf "$backup_dir/data.tar.gz"
    [ ! -f "$backup_dir/vapid-keys.tar.gz" ] || tar -xzf "$backup_dir/vapid-keys.tar.gz"
    docker compose -f docker-compose.prod.yml exec -T db sh -c \
      'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
      < "$backup_dir/rawkoon.dump"
    docker compose -f docker-compose.prod.yml start rawkoon

After restoring, sign in as an administrator, verify the Library count and
Settings values, and run a library health check. Confirm media paths are
mounted at their original locations before rescanning or post-processing.

## Reverse proxy

Set <code>BASE_URL</code> and <code>CORS_ORIGIN</code> to Rawkoon's public
URL. Forward <code>X-Forwarded-For</code> so rate limiting sees the real client
IP. Rawkoon trusts the leftmost <code>X-Forwarded-For</code> entry from a
private-network proxy, so the proxy must overwrite the header, not append to
it: behind Caddy with <code>trusted_proxies</code>, set
<code>header_up X-Forwarded-For {client_ip}</code>, or a client behind
Cloudflare can still spoof the leftmost entry. Download-client polling uses the client URL configured in Settings, so an
internal Docker address avoids a round trip through the public proxy.

## Troubleshooting: the doctor

The doctor probes every external dependency Rawkoon needs — database,
migrations, Valkey, scheduled jobs, library paths, free space, hardlink
support, indexer manager, download client, Jellyfin and TMDB — and prints one
line per check, with a fix under any check that is not OK.

Run it against a running instance:

    docker compose -f docker-compose.prod.yml exec rawkoon bun run doctor

Admins can also fetch the same report as JSON from
<code>GET /api/admin/doctor</code>. Each line is either `OK` (healthy),
`WARN` (works, but something needs attention — for example a pending
migration or an unset library path) or `FAIL` (broken, with the real cause,
such as a refused connection or a rejected API key). The exit code is `1`
when any check fails and `0` otherwise, so scripts can gate on it. In
development, run it from <code>apps/api</code> with `bun run doctor:dev`.
