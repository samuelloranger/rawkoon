<p align="center">
  <img src="apps/web/public/icon.svg" width="96" alt="Rawkoon logo" />
</p>

<h1 align="center">Rawkoon</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/samuelloranger/rawkoon" alt="License: GPL-3.0" /></a>
  <a href="https://github.com/samuelloranger/rawkoon/releases"><img src="https://img.shields.io/github/v/release/samuelloranger/rawkoon" alt="Latest release" /></a>
  <a href="https://github.com/samuelloranger/rawkoon/actions/workflows/ci.yml"><img src="https://github.com/samuelloranger/rawkoon/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/samuelloranger/rawkoon/pkgs/container/rawkoon"><img src="https://img.shields.io/badge/ghcr.io-rawkoon-2496ED?logo=docker&logoColor=white" alt="Container image" /></a>
  <a href="https://buymeacoffee.com/samlo122"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black" alt="Buy me a coffee" /></a>
</p>

![Library screenshot](docs/screenshots/library.png)

Rawkoon is a self-hosted movie and TV library with a built-in download manager.
It discovers titles through TMDB, searches releases through your indexer,
downloads through qBittorrent, and tracks the library from one web UI.

> **Early-stage project.** Breaking changes may occur between releases.

## Start here

📖 **Live documentation: [samlo.cloud/rawkoon](https://samlo.cloud/rawkoon)**

## Run Rawkoon

    cp docker-compose.prod-example.yml docker-compose.prod.yml
    cp .env.example .env
    # Set SECRET_KEY, BETTER_AUTH_SECRET, and DATABASE_URL.
    docker compose -f docker-compose.prod.yml up -d
    docker compose -f docker-compose.prod.yml exec rawkoon bunx prisma migrate deploy

The application listens on port 3000 by default.

## License

[GPL-3.0](LICENSE)
