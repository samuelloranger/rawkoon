# Repo split: rawkoon org with per-app repos

Status: planned, not started. No execution until explicitly requested.

## Problem

A single GitHub Release (`vX.Y.Z` tag, `release: published` event) currently
triggers all of: Docker image publish (`docker-publish.yml`, which
auto-deploys production via `DEPLOYER_WEBHOOK_URL`) and the iOS TestFlight
upload (`ios.yml`). There is no way to ship one target (say, iOS only)
without also shipping the other.

## Decision

Split into a GitHub org with one repo per app, matching the convention used
by comparable projects (Bitwarden: mobile/server/clients as separate repos;
Signal; Nextcloud). Rejected alternative: keep one repo, gate each workflow
job with `if: startsWith(github.event.release.tag_name, '<prefix>-')` per
app. That alternative is cheaper (~10 lines, no history surgery, no repo
transfer) and was the initial recommendation, but isn't how projects at
comparable scale (mobile + server, one team) actually do it in practice —
that convention is a JS-package-monorepo pattern (release-please
`tag-separator`, changesets), not a multi-native-platform-app pattern.
Reference case checked: `Expensify/App` (RN mobile+web monorepo) does NOT
scope releases per platform either — it ships android+iOS together on every
deploy, gated only by staging/production, not evidence either way for
splitting vs. gating.

Scope: split `apps/ios` out. `apps/api` + `apps/web` + `apps/shared` stay
together in the main repo — they share TypeScript types today, unlike iOS
which has zero code coupling with anything (different language,
HTTP-client-only relationship to the API).

## Target layout

GitHub org: `rawkoon`

| Repo | Contents | Notes |
|---|---|---|
| `rawkoon/rawkoon` | `apps/api`, `apps/web`, `apps/shared`, `docker-publish.yml` | Existing `samuelloranger/rawkoon` repo, transferred into the org in place (keeps issues/PRs/stars/history). Image becomes `ghcr.io/rawkoon/rawkoon`. |
| `rawkoon/rawkoon-ios` | current `apps/ios/*` | New repo, history extracted via `git filter-repo --subdirectory-filter apps/ios`. |

Local workspace: `~/sites/rawkoon-ios` as a new sibling directory to
`~/sites/rawkoon`, per the existing "each subdirectory is an independent
repo" convention in `~/sites/CLAUDE.md`.

## Migration order

1. Create the `rawkoon` GitHub org.
2. Extract `apps/ios`: fresh clone of current repo → `git filter-repo
   --subdirectory-filter apps/ios` → push to new `rawkoon/rawkoon-ios`.
   (Extract before transferring, so filter-repo runs against a repo still
   owned by the personal account — order matters, not required, but keeps
   the extraction step independent of the transfer.)
3. Transfer `samuelloranger/rawkoon` → the `rawkoon` org (GitHub's built-in
   repo transfer; becomes `rawkoon/rawkoon`, same repo, new owner).
4. In `rawkoon/rawkoon`, one commit: remove `apps/ios/` and
   `.github/workflows/ios.yml`. Check `docker-publish.yml`, compose files,
   deploy docs, and the deployer webhook config for any hardcoded `samuelloranger/rawkoon` (vs.
   `${{ github.repository_owner }}`, which auto-flips on transfer). Verify
   GHCR actually redirects the old image path before relying on it in
   production — GitHub redirects the repo's git remote, unconfirmed whether
   GHCR does the same for pull requests against the old `ghcr.io/samuelloranger/rawkoon` path.
5. In `rawkoon/rawkoon-ios`: add adapted CI (`ios.yml` content, paths
   rewritten to repo-root instead of `apps/ios/**`), its own
   release-triggered publish job (no path/tag gating needed now — the repo
   boundary is the scope). Move over the app-level `.claude/CLAUDE.md` and
   skills (`deploying-rawkoon`, `writing-rawkoon-release-notes`) as far as
   they apply per-app; move the Apple signing secrets to the new repo.
6. Clone the new repo into `~/sites/rawkoon-ios`; delete `apps/ios` from the
   working copy of `~/sites/rawkoon`.
7. Update `~/sites/CLAUDE.md` project table (2 rows instead of 1) and the
   `rawkoon` root `CLAUDE.md` (drop the iOS sections, they move to the new
   repo's `CLAUDE.md`). Update board tasks referencing the old layout.

## Known costs (accepted)

- Cross-cutting features that touch both iOS and the API in one PR today
  (APNs push, Google SSO, EPUB reader + detail lanes, settings parity,
  single-file audiobook, listening stats, quality profiles — roughly 13 of
  the last ~300 iOS-touching commits) become two PRs across two repos, with
  an ordering dependency (API merges/ships first) and no single bisectable
  commit for "the feature landed."
- 2x secrets/CI maintenance instead of 1x (Apple TestFlight profile secret
  already needed manual regeneration once — see `ios-release-signing-profile-secret`
  memory — now duplicated across repos that need it).
- Board/CLAUDE.md/memory context fragments across 2 repos instead of 1.
- `git filter-repo` surgery is one-way in practice (don't re-merge later).

## Out of scope for this spec

Actual execution (org creation, filter-repo run, transfer, workflow
rewrites, secrets migration) — this doc is the plan; execution needs its own
pass through `writing-plans` when the user is ready to start.
