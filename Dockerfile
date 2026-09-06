# Build stage (using Bun)
FROM oven/bun:1.4.0 AS builder

WORKDIR /app

# Copy workspace manifests first for better cache use.
COPY bun.lock ./
COPY package.json ./
COPY bunfig.toml ./
COPY tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/shared/package.json ./apps/shared/
COPY apps/web/package.json ./apps/web/

# Install workspace dependencies from repo root.
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source for all apps needed at build time
COPY apps/shared/ ./apps/shared/
COPY apps/web/ ./apps/web/

# Build the React frontend
# The web build stamps this into the service worker's cache name, so a release
# invalidates the previous build's cached assets. Declared here as well as in the
# runtime stage, which is where the API reads it.
ARG APP_VERSION=0.0.0-dev
ENV APP_VERSION=$APP_VERSION

RUN cd apps/web && bun run build

# Final production stage (using a slim Bun image)
FROM oven/bun:1.4.0-slim

# Baked in at build time by the CI pipeline.
# Falls back to local development values when build args are not provided.
ARG APP_VERSION=0.0.0-dev
ARG GITHUB_RELEASES_REPO=samuelloranger/rawkoon
ENV APP_VERSION=$APP_VERSION
ENV GITHUB_RELEASES_REPO=$GITHUB_RELEASES_REPO

WORKDIR /app

# Set locale for UTF-8 support
ENV LANG=C.UTF-8

# Prisma runtime requires OpenSSL; curl for outbound HTTP; mediainfo for file
# scanning (video and audiobook containers alike). Epub OPF reading needs no
# binary: the zip container is parsed in-process by utils/books/zipReader.
# Keep ffmpeg installed: audiobook chapter probing/splitting shells out to it.
RUN apt-get update -y && apt-get install -y openssl curl mediainfo mkvtoolnix ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy only what's needed for the runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock

# Copy API and shared source code
COPY apps/api ./apps/api
COPY apps/shared ./apps/shared

# The isolated linker (bunfig.toml) keeps each workspace's dependencies in a
# per-package node_modules of symlinks into /app/node_modules/.bun, so copying
# the root node_modules alone leaves the API without any of its own deps.
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/shared/node_modules ./apps/shared/node_modules

# Set working directory to the api application
WORKDIR /app/apps/api

# Copy built frontend assets into the API's public directory
COPY --from=builder /app/apps/web/dist ./public

# Expose the application port
EXPOSE 3000

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Run as the non-root "bun" user (uid/gid 1000, pre-created in the base image).
# Prisma generate/migrate at runtime write into /app/node_modules, and images/
# vapid keys are written under /app, so the whole app tree must be owned by bun.
# The data + vapid_keys dirs are pre-created so named volumes inherit bun ownership.
RUN mkdir -p /app/data/images /app/vapid_keys /app/apps/api/data/images \
    && chown -R bun:bun /app
USER bun

# Probe /api/health (SELECT 1 + redis.ping). start-period covers migrate-on-boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# Run migrations then start the application
CMD ["./entrypoint.sh"]
