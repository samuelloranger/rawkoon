# Build stage (using Bun)
FROM oven/bun:1.3.11 AS builder

WORKDIR /app

# Copy workspace manifests first for better cache use.
COPY bun.lock ./
COPY package.json ./
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
RUN cd apps/web && bun run build

# Final production stage (using a slim Bun image)
FROM oven/bun:1.3.11-slim

# Baked in at build time by the CI pipeline.
# Falls back to local development values when build args are not provided.
ARG APP_VERSION=0.0.0-dev
ARG GITHUB_RELEASES_REPO=samuelloranger/rawkoon
ENV APP_VERSION=$APP_VERSION
ENV GITHUB_RELEASES_REPO=$GITHUB_RELEASES_REPO

WORKDIR /app

# Set locale for UTF-8 support
ENV LANG=C.UTF-8

# Prisma runtime requires OpenSSL; curl for outbound HTTP; mediainfo for file scanning
RUN apt-get update -y && apt-get install -y openssl curl mediainfo mkvtoolnix \
    && rm -rf /var/lib/apt/lists/*

# Copy only what's needed for the runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock

# Copy API and shared source code
COPY apps/api ./apps/api
COPY apps/shared ./apps/shared

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

# Run migrations then start the application
CMD ["./entrypoint.sh"]
