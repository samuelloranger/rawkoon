# Contributing

## Local environment

Requirements: Bun 1.3 or newer and Docker with Docker Compose.

    git clone https://github.com/samuelloranger/rawkoon.git
    cd rawkoon
    make install
    cp .env.example .env
    make dev-services
    make dev-api
    make dev-web

Run the last three commands in separate terminals. Configure the secrets and
email allowlists in <code>.env</code> before signing in.

## Before opening a pull request

Create a branch from <code>main</code>, make the change, then run:

    make typecheck
    make lint
    make test

CI also checks formatting. Keep pull requests focused and explain any visible
behavior change.

## Conventions

- Components use PascalCase; hooks use a camelCase name beginning with
  <code>use</code>.
- API route plugins use camelCase names ending in <code>Routes</code>.
- API responses use snake_case and URLs use kebab-case.
- Web imports use <code>@/</code>; API imports use <code>@rawkoon/api/...</code>;
  cross-application imports use the <code>@rawkoon/shared</code> package boundary.
- Put types, pure utilities, and shared constants in <code>apps/shared</code>
  only when both API and web consume them. Query hooks and query keys remain in
  <code>apps/web</code>.

## Database changes

Edit <code>apps/api/prisma/schema.prisma</code>, then create and review a
migration:

    make migrate-dev

Use <code>make migrate-deploy</code> only to apply existing migrations. Do not
use development migration commands against production.

## Documentation

The documentation site uses VitePress:

    bun run docs:dev
    bun run docs:build

Keep documentation task-oriented. Avoid source-file inventories and duplicate
guides; explain stable product and contributor behavior, then link to the code
when an implementation detail genuinely matters.
