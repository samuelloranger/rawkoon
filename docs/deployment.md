# Deployment and recovery

Rawkoon ships as one Docker image containing the API and the built web
application. In production, the API serves the SPA from the same origin; only
one application port needs to be exposed.

## Deploy

Start from <code>docker-compose.prod-example.yml</code>, copy it to
<code>docker-compose.prod.yml</code>, configure <code>.env</code>, and run:

    docker compose -f docker-compose.prod.yml up -d

The image expects PostgreSQL and Redis. Mount these directories from the
example compose file:

- <code>data/</code> for image storage and application file operations.
- <code>vapid_keys/</code> when using file-based web-push keys.
- Your media-library directories at the same paths Rawkoon is configured to
  use.

The container applies pending Prisma migrations when it starts. To apply them
manually:

    docker compose -f docker-compose.prod.yml exec rawkoon bun run db:migrate

Do not run development migration commands against production.

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
IP. The qBittorrent webhook setup prefers the internal Docker address when one
is available, which avoids a round trip through the public proxy.
