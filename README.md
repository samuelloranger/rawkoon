# Rawkoon

A self-hosted movie and TV library with a built-in download manager — a single-app replacement for the Radarr/Sonarr/Overseerr stack. Discover titles, search releases, grab them through qBittorrent, and track your library, all from one web app.

Rawkoon includes a **native media library that replaces Radarr and Sonarr** — movies and TV in one app, with TMDB discovery, release search, quality profiles, and download workflows built in. Already running \*arr? **Settings → Library import** migrates your existing Radarr and/or Sonarr library into Rawkoon so you can switch without starting over.

> **Early-stage project.** Breaking changes may occur between releases.

## Features

**Media Library & Downloads**

- **Media Library** — Native Radarr/Sonarr replacement: TMDB discovery, release search, quality profiles, and grab workflows for movies and TV
- **\*arr Migration** — One-time import from Radarr and/or Sonarr (library metadata, files, MediaInfo) to ease switching from an existing \*arr stack
- **Explore** — Browse and discover movies and TV via TMDB, then add straight to your library
- **Watchlist** — Track what you want to watch with one-click add to your library
- **Quality Profiles & Custom Formats** — Define preferred quality, then score and pick releases automatically
- **Torrents** — qBittorrent management with real-time activity streaming (SSE)

**Media Tracking**

- **Collections** — Manage and complete your media collections
- **Calendar** — Upcoming movie / TV / episode release schedule
- **Jellyfin/Plex** — Latest additions, now-watching, and inbound webhook notifications

**Platform**

- **Dashboard** — Media-focused overview: download activity, latest additions, upcoming releases
- **Integrations** — Configurable connections to external media services
- **Notifications** — In-app + Web Push (VAPID) delivery
- i18n support via i18next
- PWA-ready with service worker
- Activity log across features

## Tech Stack

| Layer          | Technology                                                     |
| -------------- | -------------------------------------------------------------- |
| Runtime        | [Bun](https://bun.sh)                                          |
| API framework  | [Elysia](https://elysiajs.com)                                 |
| Database       | PostgreSQL 15 + [Prisma](https://prisma.io)                    |
| Cache / Queues | Redis + BullMQ                                                 |
| Image storage  | Local filesystem (`IMAGE_STORAGE_DIR`)                         |
| Frontend       | React 19 + Vite                                                |
| Routing        | TanStack Router                                                |
| Data fetching  | TanStack Query                                                 |
| Styling        | Tailwind CSS 4                                                 |
| Auth           | [Better Auth](https://www.better-auth.com) + HTTP-only cookies |

## Quick Start (Docker)

The production image runs both the API and the pre-built frontend from a single container.

```bash
# 1. Copy and edit the example compose file
cp docker-compose.prod-example.yml docker-compose.prod.yml

# 2. Create your .env from the example
cp .env.example .env
# Edit .env — at minimum set SECRET_KEY, BETTER_AUTH_SECRET, ALLOWED_EMAILS, ADMIN_EMAILS, DATABASE_URL

# 3. Start everything
docker compose -f docker-compose.prod.yml up -d

# 4. Run database migrations
docker compose -f docker-compose.prod.yml exec rawkoon bunx prisma migrate deploy
```

The app will be available on port `3000` by default.

## Development Setup

**Prerequisites:** [Bun](https://bun.sh) >= 1.3

```bash
# Install dependencies and git hooks
make install

# Copy and configure environment
cp .env.example .env

# Terminal 1 — Start PostgreSQL and Redis
make dev-services

# Terminal 2 — Start the API with hot reload
make dev-api

# Terminal 3 — Start the React frontend
make dev-web
```

The API runs on `http://localhost:3001` and the frontend on `http://localhost:5173` by default.

## Configuration

Copy `.env.example` to `.env`. Required variables:

| Variable             | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `SECRET_KEY`         | Encryption key for stored secrets — change from default                  |
| `BETTER_AUTH_SECRET` | Session signing secret — min 32 random chars (`openssl rand -base64 32`) |
| `DATABASE_URL`       | PostgreSQL connection string                                             |
| `ALLOWED_EMAILS`     | Comma-separated list of emails allowed to register                       |
| `ADMIN_EMAILS`       | Comma-separated list of admin emails                                     |
| `BASE_URL`           | Public URL of the app (e.g. `https://rawkoon.example.com`)               |

Optional integrations:

| Variable                                 | Description                  |
| ---------------------------------------- | ---------------------------- |
| `TMDB_API_KEY`                           | Required for media discovery |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web push notifications       |
| `SMTP_*`                                 | Email delivery               |

See `.env.example` for the full reference.

### General Settings (Admin UI)

Admins can configure global app behavior via **Settings → General**:

| Setting                      | Default            | Options                    | Purpose                                   |
| ---------------------------- | ------------------ | -------------------------- | ----------------------------------------- |
| **Country/Region**           | US                 | Any supported country      | Sets the TMDB release-date region         |
| **Upcoming releases window** | 1 year (12 months) | 3, 6, 12, or 24 months     | How far ahead to show upcoming movies/TV  |
| **Languages**                | English, French    | Multi-select (8 languages) | Filter TMDB discovery results by language |

## Common Commands

```bash
make install           # Install dependencies
make dev-services      # Start backing services (PostgreSQL, Redis)
make dev-api           # Start API with hot reload
make dev-web           # Start frontend with live reload
make build             # Build frontend for production
make test              # Run all tests
make lint              # ESLint — web + API (same scope as CI)
make typecheck         # Type-check all workspaces that expose `typecheck`

# Database
make migrate-dev       # Create a new migration
make migrate-deploy    # Apply pending migrations (production)
make migrate-studio    # Open Prisma Studio
```

## Project Structure

```
rawkoon/
├── apps/
│   ├── api/              # Elysia API (routes, services, workers, jobs)
│   │   └── prisma/       # Database schema and migrations
│   ├── web/              # React frontend (pages, features, components)
│   └── shared/           # Shared types, utils, constants
├── docs/              # Integration guides
├── docker-compose.yml # Dev: PostgreSQL + Redis (`make dev-services`)
└── Makefile
```

Shared primitives (mostly types and utilities) live in `apps/shared` (`@rawkoon/shared`). TanStack Query hooks and `queryKeys` sit under `apps/web` (see `apps/web/src/lib/queryKeys.ts`).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development conventions, branch naming, and PR guidelines.

## License

[MIT](./LICENSE)
