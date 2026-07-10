# Self-host Rawkoon

This guide installs Rawkoon on your own server and completes the first
administrator configuration. Once the instance is running and connected, see
[Getting started](/getting-started) for the day-to-day media workflow.

## Before you start

You need:

- Docker and Docker Compose.
- A PostgreSQL database and Redis instance. The production example starts both.
- A TMDB API key for discovery.
- qBittorrent and either Prowlarr or Jackett before downloading media.
- Paths that are mounted into both Rawkoon and qBittorrent if Rawkoon will
  post-process downloaded files.

## Start the production stack

The production image contains both the API and the built web application.

    cp docker-compose.prod-example.yml docker-compose.prod.yml
    cp .env.example .env

Set at least these values in <code>.env</code>:

- <code>SECRET_KEY</code>
- <code>BETTER_AUTH_SECRET</code>
- <code>DATABASE_URL</code>

Then start the stack and apply migrations:

    docker compose -f docker-compose.prod.yml up -d
    docker compose -f docker-compose.prod.yml exec rawkoon bunx prisma migrate deploy

Rawkoon listens on port <code>3000</code> by default.

## Create the administrator

Rawkoon has no open registration. Open the instance in a browser and create
an account: the **first** account created becomes the administrator. Once it
exists, public sign-up closes and every later account is created by an
administrator from **Settings → Users**.

<code>.env.example</code> is the complete environment-variable reference. Common
optional settings include VAPID keys for web push and an OMDB API key.

## Configure the media path

Sign in as an administrator and use **Settings → Library** to:

1. Enable post-processing.
2. Set distinct movie and show library paths.
3. Choose **Hardlink** or **Move** as the file operation.
4. Set the naming templates and minimum seed ratio.
5. Select the default quality profile after creating one.

Hardlinking is usually the best choice for torrents: the library receives a
second directory entry while qBittorrent can keep seeding the original file.
Both locations must be on the same filesystem. Use Move only when you do not
need the completed torrent to remain at its download path.

## Connect the required services

Use **Settings → Integrations** to configure and test:

1. **TMDB** for discovery and catalog metadata.
2. **qBittorrent** as the download client. Use **Configure webhooks** so
   Rawkoon receives add and completion notifications.
3. **Prowlarr** or **Jackett** as the active indexer manager.

See [Integrations](/integrations) for the full service list and setup detail.

## Next steps

- [Deployment and recovery](/deployment) covers production hardening, the
  mounted directories, and the full-instance backup and restore procedure.
- [Getting started](/getting-started) walks a signed-in user through adding a
  title and grabbing a release once the instance is configured.
