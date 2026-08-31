# Rawkoon push relay. Holds the APNs signing key and forwards pushes to Apple.
# Built and run as its own stack, separate from any Rawkoon server: it is the
# only piece that holds the APNs key and it must not share a blast radius.
FROM oven/bun:1.4-alpine
WORKDIR /app
COPY package.json ./
RUN bun install
COPY src ./src
EXPOSE 8090
CMD ["bun", "src/index.ts"]
