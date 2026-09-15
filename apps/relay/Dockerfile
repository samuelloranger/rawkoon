# Rawkoon push relay. Holds the APNs signing key and forwards pushes to Apple.
# Built and run as its own stack, separate from any Rawkoon server: it is the
# only piece that holds the APNs key and it must not share a blast radius.
#
# Build context is the repo root (this is a Bun workspace and the lockfile
# lives there), e.g.:
#   docker build -f apps/relay/Dockerfile -t rawkoon-relay .
FROM oven/bun:1.4.2-alpine

WORKDIR /app

# Copy workspace manifests first for better cache use. Only relay's own
# package.json is needed alongside the root lockfile — bun skips the other
# workspaces listed in bun.lock that aren't present on disk.
COPY bun.lock ./
COPY package.json ./
COPY bunfig.toml ./
COPY apps/relay/package.json ./apps/relay/

# Frozen, production-only install: this host holds the APNs signing key, so
# dependency versions must come from the committed lockfile, not whatever
# `hono`/`zod` resolve to at build time.
RUN bun install --frozen-lockfile --production --filter @rawkoon/relay

COPY apps/relay/src ./apps/relay/src

WORKDIR /app/apps/relay

EXPOSE 8090

# Run as the non-root "bun" user (uid/gid 1000, pre-created in the base image).
RUN chown -R bun:bun /app
USER bun

# Probe GET /health on the service's own port. Alpine's bun image ships
# wget (busybox), not curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8090}/health" || exit 1

CMD ["bun", "src/index.ts"]
