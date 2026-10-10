---
name: deploying-rawkoon
description: Use when deploying, releasing, shipping, or rolling back rawkoon — bumping the version, cutting the GitHub release that publishes the ghcr.io Docker image, diagnosing a failed "Build and Push Docker Image" run, or recovering a production instance stuck on a bad image tag.
---

# Deploying Rawkoon

## Overview

Two lanes publish the same image. Production tracks `ghcr.io/samuelloranger/rawkoon:edge`.

## Edge builds come first

Every push to `main` that CI passes already ships. `docker-publish.yml` runs on the `edge` lane (a `workflow_run` of CI): it builds the image as `vX.Y.Z+1-main.N` (the next patch above `package.json`, N = the workflow's run number), pushes `:sha-<short>`, moves `:edge` and POSTs the deployer webhook, so production redeploys within a minute or two. A push that changes `apps/ios` also uploads iOS and Mac to TestFlight as `X.Y.Z+1` (`ios.yml`, `edge` job). No tag and no GitHub release.

So **a fix needs a merge, not a release.** Cut a release to collect what has landed into a version with notes: weekly, or at a milestone. Never one per fix.

- `refs/edge/server` records the commit `:edge` should hold, and `:edge` is always that commit's `:sha-<short>`. Edge runs are not queued; CI runs can finish out of order, and the mark only moves to a commit that contains it, so `:edge` never goes back to older code. A run whose retag failed is repaired by re-running it or by the next green push.
- An edge TestFlight upload is skipped when `main` already has newer app changes (their run uploads them) or a version bump (its release does).
- A commit that changes the `version` in `package.json` is the release commit: both edge lanes skip it, because its release builds it under the real version.
- Edge versions (`-main.N`) do not send the "App updated" notification; the release that follows does.
- Merging to `main` is therefore a production deploy. Only the main interactive session merges.

## Release lane

There is **no release script**. A release is a GitHub Release, cut by hand, and everything downstream hangs off it:

- `.github/workflows/docker-publish.yml` triggers on `release: [published]` — not on tag push. It builds `Dockerfile` and pushes `ghcr.io/samuelloranger/rawkoon` with `latest`, `{{version}}`, `{{major}}.{{minor}}` and `sha-<short>`, then moves `:edge` to it (unless `:edge` already holds a later commit). `APP_VERSION` is the release tag (it keeps the `v`), then it POSTs an HMAC-signed webhook to `DEPLOYER_WEBHOOK_URL` if that secret exists, and no-ops if it doesn't.
- `docs-pages.yml` (publish VitePress docs to samlo-cloud) and `screenshots.yml` (re-capture README screenshots and commit them to the default branch) also fire on `release: published`.

**Version source of truth: the `version` field in the root `package.json`.** The git tag is `v` + that value (`1.4.2` → `v1.4.2`), and historically the bump is committed *in the release commit itself* — sometimes as a lone `chore: bump version to X.Y.Z`, sometimes folded into the last fix. Nothing validates that the tag and `package.json` agree, so getting them out of sync is silent and shows the wrong version in the app.

## Pre-flight

CI (`ci.yml`) must be green on `main` first — it gates format, lint, typecheck, the production web build, and tests. Locally:

```bash
bun run formatCheck
bun run lint
bun run typecheck
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

`--generate-notes` is a placeholder, not the description. Every release then gets a hand-written title and body — **invoke the `writing-rawkoon-release-notes` skill** and replace the auto-generated notes before calling the release done. Migrations that rename or drop anything, dropped env vars, and externally-reported issues all have mandatory content there.

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

The version and `sha-<short>` tags are immutable, so rollback is repointing the compose file at one of them — `edge` moves on the next green push to `main` and `latest` on the next release, so neither can be trusted for this. Revert the bad commit on `main` before switching the compose file back to `:edge`, or the next deploy brings it back.

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
| Merged to `main`, production unchanged | The edge run skipped it: the commit bumps the version (its release builds it), CI failed, or `:edge` already holds a later commit. The `Plan` and `Move edge` steps of the `Build and Push Docker Image` run say which. |
| Re-tagging the same version | The workflow would rebuild and overwrite `latest` and `X.Y`. Always release the next patch instead of reusing a version. |
