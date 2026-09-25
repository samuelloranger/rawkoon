# Self-host Rawkoon

This guide will walk you through deploying Rawkoon using Docker Compose and configuring your administrator account.

## Prerequisites

Before starting, ensure you have:
* **Docker and Docker Compose** installed.
* **A TMDB API key** (free from [The Movie Database](https://www.themoviedb.org/)).
* **A download client** (qBittorrent, Transmission, or Deluge) and an **indexer manager** (Prowlarr or Jackett).

---

## 1. Create a Directory
Create a dedicated folder for Rawkoon on your server:
```bash
mkdir rawkoon && cd rawkoon
```

---

## 2. Docker Compose Configuration
Create a `docker-compose.yml` file in that folder using the official Docker image (`ghcr.io/samuelloranger/rawkoon:latest`):

```yaml
services:
  rawkoon:
    image: ghcr.io/samuelloranger/rawkoon:latest
    container_name: rawkoon
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./vapid_keys:/app/vapid_keys
      # Mount your media paths here (must be identical to download client mount paths for hardlinking).
      # The same mount covers the book and audiobook libraries if they live under it.
      # - /mnt/storage:/mnt/storage
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    networks:
      - rawkoon-network
    ports:
      - "3000:3000"

  db:
    image: postgres:17
    container_name: rawkoon-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
    networks:
      - rawkoon-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

  valkey:
    image: valkey/valkey:8-alpine
    container_name: rawkoon-valkey
    restart: unless-stopped
    command: valkey-server --requirepass ${VALKEY_PASSWORD} --bind 0.0.0.0 --protected-mode yes
    volumes:
      - valkey_data:/data
    networks:
      rawkoon-network:
        # Alias so a VALKEY_HOST/REDIS_HOST of "redis" still resolves.
        aliases:
          - redis

networks:
  rawkoon-network:
    driver: bridge

volumes:
  db_data:
  valkey_data:
```

---

## 3. Environment Configuration
Create a `.env` file in the same directory:

```env
# -----------------------------------------------------------------------------
# Database Setup
# -----------------------------------------------------------------------------
POSTGRES_DB=rawkoon
POSTGRES_USER=rawkoon
POSTGRES_PASSWORD=choose_a_strong_password
# Must match the credentials above. Use 'db' as the database hostname.
DATABASE_URL=postgresql://rawkoon:choose_a_strong_password@db:5432/rawkoon

# -----------------------------------------------------------------------------
# Valkey Setup (Redis-compatible; the old REDIS_* names still work as a fallback)
# -----------------------------------------------------------------------------
VALKEY_HOST=valkey
VALKEY_PORT=6379
VALKEY_DB=0
VALKEY_PASSWORD=choose_a_valkey_password

# -----------------------------------------------------------------------------
# App Secrets
# Generate random 32-character secrets using: openssl rand -base64 32
# -----------------------------------------------------------------------------
SECRET_KEY=paste_random_secret_here
BETTER_AUTH_SECRET=paste_random_secret_here

# -----------------------------------------------------------------------------
# App Configuration
# -----------------------------------------------------------------------------
# Change this to your public domain if accessing externally (e.g., https://rawkoon.example.com)
BASE_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
NODE_ENV=production
TZ=UTC
```

---

## 4. Run the Stack
Start the containers in detached mode:
```bash
docker compose up -d
```

Rawkoon will automatically wait for the database, run migrations, and listen on port `3000`.

---

## 5. Initial UI Configuration
Once the containers are up:

1. **Create the Administrator Account:** Open `http://localhost:3000` (or your domain) in your browser. The **first** account registered becomes the instance administrator. Once created, public registration closes automatically.
2. **Set up Media Paths:** Navigate to **Settings → Library** to configure your movie/show storage paths, file naming template, and select whether you want to **Move** or **Hardlink** (recommended for seeding torrents) files.
3. **Connect Integrations:** Go to **Settings → Integrations** to enter:
   - Your **TMDB API key** (required for search and discovery).
   - Your indexer manager (**Prowlarr** or **Jackett**).
   - Your download client (**qBittorrent**, **Transmission**, or **Deluge**).

See [Getting started](/getting-started) to add your first movie or show!

## Re-encoding (optional GPU)

Settings → Admin → Re-encode runs ffmpeg inside the Rawkoon container. CPU encoding (HEVC via x265, AV1 via SVT-AV1) works everywhere. To let it use an Intel or AMD GPU through VA-API, pass the render device and group:

```yaml
services:
  rawkoon:
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "${RENDER_GID}"   # getent group render | cut -d: -f3
```

The modal shows "Detected: VAAPI · renderD128" when it works, or the reason when it doesn't.

Software encodes of 4K sources can use several GB of RAM; give the container at least 4 GB (`deploy.resources.limits.memory`) if you re-encode 4K on the CPU.

Re-encoded files replace the originals only after validation. Files that are still hardlinked to a seeding torrent keep using disk space until that torrent is removed.
