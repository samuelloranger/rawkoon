---
name: deploying-rawkoon
description: Use when deploying, releasing, shipping, or rolling back rawkoon — bumping the version, cutting the GitHub release that publishes the ghcr.io Docker image, diagnosing a failed "Build and Push Docker Image" run, or recovering a production instance stuck on a bad image tag.
---

# Deploying Rawkoon

## Overview

There is **no release script**. A release is a GitHub Release, cut by hand, and everything downstream hangs off it:

- `.github/workflows/docker-publish.yml` triggers on `release: [published]` — not on tag push. It builds `Dockerfile` and pushes `ghcr.io/samuelloranger/rawkoon` with three tags: `latest`, `{{version}}`, and `{{major}}.{{minor}}`. `APP_VERSION` is baked from `github.ref_name` (so it keeps the `v`), then it POSTs an HMAC-signed webhook to `DEPLOYER_WEBHOOK_URL` if that secret exists, and no-ops if it doesn't.
- `docs-pages.yml` (publish VitePress docs to samlo-cloud) and `screenshots.yml` (re-capture README screenshots and commit them to the default branch) also fire on `release: published`.

**Version source of truth: the `version` field in the root `package.json`.** The git tag is `v` + that value (`1.4.2` → `v1.4.2`), and historically the bump is committed *in the release commit itself* — sometimes as a lone `chore: bump version to X.Y.Z`, sometimes folded into the last fix. Nothing validates that the tag and `package.json` agree, so getting them out of sync is silent and shows the wrong version in the app.

## Pre-flight

CI (`ci.yml`) must be green on `main` first — it gates format, lint, **both** typechecks, the production web build, and tests. Locally:

```bash
bun run formatCheck && (cd apps/shared && bun run formatCheck)
bun run lint
bun run typecheck && bun run typecheck:native
bun run test
bun run build
```

Then check migrations: if `apps/api/prisma/migrations/` gained a directory since the last tag, the container will apply it on boot via `entrypoint.sh` — confirm it is additive and safe to run against live data. There is no down-migration path.

```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD -- apps/api/prisma/migrations
```

## Cutting the release

```bash
git checkout main && git pull --rebase   # screenshots.yml commits back to main after every release
# bump "version" in the root package.json, commit it
gh workflow view CI --repo samuelloranger/rawkoon   # or: gh run list --workflow CI --limit 1
git push
gh release create v1.4.3 --generate-notes --title v1.4.3
gh run watch $(gh run list --workflow 'Build and Push Docker Image' --limit 1 --json databaseId -q '.[0].databaseId')
```

`gh release create` creates the tag if it doesn't exist. Do **not** create a draft release: only `published` triggers the workflows, and a draft publishes nothing.

## Verify

```bash
gh run list --workflow 'Build and Push Docker Image' --limit 1
docker buildx imagetools inspect ghcr.io/samuelloranger/rawkoon:1.4.3
```

Then on the production host: the container should already be running the new image if the deployer webhook is wired; otherwise pull it yourself.

```bash
docker compose -f docker-compose.prod.yml pull rawkoon
docker compose -f docker-compose.prod.yml up -d rawkoon
docker compose -f docker-compose.prod.yml logs -f rawkoon   # expect: DB ready → prisma generate → migrate deploy → Starting API server
curl -fsS https://<host>/api/health                          # {"status":"ok"}
```

TODO(sam): the production host / public URL is not recorded anywhere in this repo — fill in the real hostname and the deployment directory that holds `docker-compose.prod.yml` and `.env`.

TODO(sam): confirm whether `DEPLOYER_WEBHOOK_URL` is actually configured as a repo secret. If it is, the pull/up step above is automatic and doing it by hand is redundant; if it isn't, the workflow prints "No DEPLOYER_WEBHOOK_URL configured" and the deploy is fully manual.

## Rolling back

The image tags are immutable per version, so rollback is repointing the compose file at the previous one — `latest` always follows the newest release and cannot be trusted for this.

```bash
# in docker-compose.prod.yml: image: ghcr.io/samuelloranger/rawkoon:1.4.2
docker compose -f docker-compose.prod.yml up -d rawkoon
```

**Rolling back the code does not roll back the database.** `entrypoint.sh` already ran `migrate deploy`; the old image boots against the new schema. If the release contained a destructive migration, restore from the Postgres dump instead — the exact `pg_dump`/`pg_restore` sequence is in `docs/deployment.md`.

To un-publish a bad release so `screenshots.yml`/docs don't reference it and the GitHub "latest release" pointer moves back: `gh release edit v1.4.3 --prerelease`, or `gh release delete v1.4.3 --cleanup-tag` to remove it entirely. Deleting the release does **not** delete the already-pushed ghcr tags — do that from the package page if the image is genuinely poisonous.

## Landmines

| Symptom | Cause |
|---|---|
| Push rejected, "remote has diverged" | `screenshots.yml` commits `docs/screenshots/*.png` to the default branch after every release. `git pull --rebase` first. |
| App shows `0.0.0-dev+<timestamp>` | `APP_VERSION` build arg wasn't passed — the image was built locally, not by the release workflow. Version-change notifications stay suppressed in that state, by design. |
| Release published, no image | The workflow only listens to `release: published`. A pushed tag with no release, or a draft release, starts nothing. |
| Container restart-loops on boot | `entrypoint.sh` failed `migrate deploy`. Read the logs: it only auto-baselines (`migrate resolve --applied 0_init`) for "already exists"-class errors and exits on anything else. |
| Re-tagging the same version | The workflow would rebuild and overwrite `latest` and `X.Y`. Always release the next patch instead of reusing a version. |
