# Deployment

How Rawkoon ships to production: one Docker image with both API and web, served via `SERVE_STATIC=true`, fronted by `docker-compose.prod.yml`.

Last verified: 2026-05-25

## Single Image Strategy

The repo `Dockerfile` is a multi-stage Bun build:

1. **Builder stage** (`oven/bun:1.3.11`) — installs workspace deps, copies `apps/shared` and `apps/web`, runs `cd apps/web && bun run build` to produce `apps/web/dist`.
2. **Runtime stage** (`oven/bun:1.3.11-slim`) — installs OS deps (`openssl`, `curl`, `mediainfo`, `mkvtoolnix`), copies API source + `node_modules`, then copies `apps/web/dist` into `apps/api/public/`. The entrypoint runs migrations then starts the API.

Build args:

- `APP_VERSION` — injected by CI from the GitHub tag, surfaced in the Settings → About panel via `versionService.ts`.
- `GITHUB_RELEASES_REPO` — defaults to `samuelloranger/rawkoon`; used by the Releases panel.

```bash
docker build -t rawkoon:latest \
  --build-arg APP_VERSION=$(git describe --tags) .
```

Why a single image: keeps the public attack surface to one port, lets the API inject the bootstrapped user payload into `index.html` server-side (see `apps/api/src/index.ts:162-174`), and avoids syncing two deploy artifacts.

## SERVE_STATIC

When `SERVE_STATIC=true`, the API:

1. Mounts `@elysiajs/static` on `/` against `./public`, with `*.html` excluded.
2. Serves pre-compressed `.gz` assets (from `vite-plugin-compression2`) when the client's `Accept-Encoding` includes gzip — see `apps/api/src/index.ts:59-83`.
3. Falls through to a `GET *` catch-all that returns `index.html` with `<script>window.__RAWKOON_BOOTSTRAP__=…</script>` injected (`apps/api/src/index.ts:162-174`). This pre-populates the user session before the SPA boots.

In dev, leave `SERVE_STATIC` unset and run Vite separately.

## docker-compose.prod.yml

Start from `docker-compose.prod-example.yml`:

```yaml
services:
  rawkoon:
    image: ghcr.io/samuelloranger/rawkoon:latest
    env_file: .env
    environment:
      - SERVE_STATIC=true
    volumes:
      - ./data:/app/data
      - ./vapid_keys:/app/vapid_keys
      - ./certs:/app/certs:ro
    depends_on:
      db: { condition: service_healthy }
    ports: ["3000:3000"]
  db: postgres:15-alpine
  redis: redis:7-alpine
```

Volumes worth mounting:

- `./data:/app/data` — image storage (`IMAGE_STORAGE_DIR=./data/images`), library/media post-processing scratch.
- `./vapid_keys:/app/vapid_keys` — optional file-based VAPID keys (alternative to env vars).

## Migrations in Prod

The Dockerfile's `entrypoint.sh` runs `prisma migrate deploy` before starting the API. To run migrations manually against a running container:

```bash
docker compose -f docker-compose.prod.yml exec rawkoon bun run db:migrate
```

`make migrate-deploy` resolves to `cd apps/api && bun run db:migrate`. **Never** run `make migrate-dev` (which is interactive and creates new migration files) or `make migrate-push` (bypasses migration history) against production.

## Reverse Proxy Notes

- Set `BASE_URL` and `CORS_ORIGIN` to the public URL.
- Pass `X-Forwarded-For` so the rate limiter sees the real client IP (`apps/api/src/middleware/rateLimit.ts:17`).
- The qBittorrent webhook URL resolver (`apps/api/src/routes/integrations/qbittorrent/index.ts`) prefers internal Docker DNS (`http://rawkoon:3000`) over the public URL — see comments in that file for the priority order.

## GitHub Releases

Production CI publishes images to `ghcr.io/samuelloranger/rawkoon`. The in-app Settings → Releases panel polls GitHub at the cron pattern `0 */6 * * *` (see `apps/api/src/services/queueService.ts:setupScheduledJobs`, job `REFRESH_GITHUB_RELEASES`).
