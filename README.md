<p align="center">
  <img src="apps/web/public/icon.svg" width="96" alt="Rawkoon logo" />
</p>

<h1 align="center">Rawkoon</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/samuelloranger/rawkoon" alt="License: GPL-3.0" /></a>
  <a href="https://github.com/samuelloranger/rawkoon/releases"><img src="https://img.shields.io/github/v/release/samuelloranger/rawkoon" alt="Latest release" /></a>
  <a href="https://github.com/samuelloranger/rawkoon/actions/workflows/ci.yml"><img src="https://github.com/samuelloranger/rawkoon/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/samuelloranger/rawkoon/pkgs/container/rawkoon"><img src="https://img.shields.io/badge/ghcr.io-rawkoon-2496ED?logo=docker&logoColor=white" alt="Container image" /></a>
</p>

![Library screenshot](docs/screenshots/library.png)

Rawkoon is a self-hosted movie and TV library with a built-in download manager.
It discovers titles through TMDB, searches releases through your indexer,
downloads through qBittorrent, and tracks the library from one web UI.

> **Early-stage project.** Breaking changes may occur between releases.

## Start here

📖 **Live documentation: [samlo.cloud/rawkoon](https://samlo.cloud/rawkoon)**

The documentation site is in [docs/](docs/). It is organized by audience:

- **Use Rawkoon** — [Getting started](docs/getting-started.md) for the
  day-to-day media workflow on a running instance.
- **Self-host Rawkoon** — [Self-hosting](docs/self-hosting.md) to install and
  configure your instance, plus [Integrations](docs/integrations.md) and
  [Deployment and recovery](docs/deployment.md).
- **Development** — [Architecture](docs/architecture.md) and
  [Contributing](docs/development/contributing.md).

To run the documentation site locally:

    bun install
    bun run docs:dev

## Run Rawkoon

    cp docker-compose.prod-example.yml docker-compose.prod.yml
    cp .env.example .env
    # Set SECRET_KEY, BETTER_AUTH_SECRET, and DATABASE_URL.
    docker compose -f docker-compose.prod.yml up -d
    docker compose -f docker-compose.prod.yml exec rawkoon bunx prisma migrate deploy

The application listens on port 3000 by default.

## License

[GPL-3.0](LICENSE)
