## Project

**Rawkoon iOS**

Rawkoon's native iPhone companion: a SwiftUI client for the self-hosted
Rawkoon server. It discovers titles, manages the download queue, and plays
downloaded audiobooks and ebooks offline. It ships to TestFlight from GitHub
Actions. The product is at **v1.19.3** (2026-09-06).

There is **no behaviour freeze**. The freeze from the 2026-09-01 clean-code
milestone was lifted on 2026-09-05 for the Dusk in Motion redesign (#96/#97).
Remaining clean-code work (APIClient split, view models, app-target tests,
haptics) is tracked on board task 966 — it is a backlog, not a freeze.

**Core Value:** The phone is the remote for the movie/TV pipeline and the
player for audiobooks. Now Playing, chapter downloads, and lock-screen
controls are why this is native rather than a PWA.

### Constraints

- **Verification**: the `macbuild` ssh host is the only real gate — Linux builds
  `RawkoonKit` alone, so no phase is "done" on a green Linux run
- **Shippability**: a phase that leaves `main` unshippable is not complete —
  but "shippable" is proved by `lint`, `kit` and `build` green on the push to
  `main`, not by an upload. **No agent cuts a release.** The `testflight` job
  is gated on a published GitHub release, and publishing one in this repo also
  triggers `docker-publish.yml`, which auto-redeploys the production container
  through `DEPLOYER_WEBHOOK_URL` — so a release is an outward-facing act with
  production consequences, and it is the user's decision alone. Never bump the
  version, tag, or publish a release to satisfy a verification gate; if a gate
  can only be met by releasing, the gate is wrong — say so and stop.
- **Tech stack**: SwiftUI, iOS 18 deployment target, Xcode 26 SDK, XcodeGen,
  Swift 6 with `SWIFT_STRICT_CONCURRENCY: complete`. Readium 3.11.0 is pinned
  (`project.yml` `exactVersion`) for the EPUB reader. No new third-party
  dependencies without an explicit ask.
- **Build settings**: edited in `project.yml`, never in a generated `.xcodeproj`
- **Appearance**: the phone UI is dark (`.preferredColorScheme(.dark)` on the
  `WindowGroup`). Do not set `UIUserInterfaceStyle: Dark` in Info.plist — that
  forces the CarPlay scene too (#89).
- **Compatibility**: no migration of on-device state — the position journal, the
  Keychain entries, and the downloaded library must survive an app update

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| deploying-rawkoon | Use when deploying, releasing, shipping, or rolling back rawkoon — bumping the version, cutting the GitHub release that publishes the ghcr.io Docker image, diagnosing a failed "Build and Push Docker Image" run, or recovering a production instance stuck on a bad image tag. | `.claude/skills/deploying-rawkoon/SKILL.md` |
| writing-rawkoon-release-notes | Use when writing or rewriting the description of a rawkoon GitHub release — right after `gh release create`, when auto-generated notes need replacing, or when backfilling several releases at once. Covers the required title format, the section order, and what counts as a highlight. | `.claude/skills/writing-rawkoon-release-notes/SKILL.md` |
