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
      # Mount your media paths here (must be identical to download client mount paths for hardlinking)
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

  redis:
    image: redis:7-alpine
    container_name: rawkoon-redis
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD} --bind 0.0.0.0 --protected-mode yes
    volumes:
      - redis_data:/data
    networks:
      - rawkoon-network

networks:
  rawkoon-network:
    driver: bridge

volumes:
  db_data:
  redis_data:
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
# Redis Setup
# -----------------------------------------------------------------------------
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=choose_a_redis_password

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
