---
name: writing-rawkoon-release-notes
description: Use when writing or rewriting the description of a rawkoon GitHub release — right after `gh release create`, when auto-generated notes need replacing, or when backfilling several releases at once. Covers the required title format, the section order, and what counts as a highlight.
---

# Writing Rawkoon Release Notes

## Why this exists

`gh release create --generate-notes` produces a list of PR titles and nothing
else. The releases page is the changelog self-hosters read before pulling a new
image, and a bare PR list does not tell them whether an upgrade is safe. Every
release therefore gets a hand-written description in the format below.

**A reader must be able to tell what a release is about from the releases list
alone, without opening it.** That is the bar the title has to clear.

## Title

`v<version> — <what it does>`, an em dash, then a short human phrase. Never a
bare version, never a conventional-commit subject.

```
v1.6.5 — No duplicate auto-grabs
v1.7.0 — Books and audiobooks
v1.10.0 — Per-type quality profiles + OIDC first sign-in
```

## Body

One or two sentences of plain summary first — what changed and why anyone
cares — then only the sections that apply, in this order:

| Section | Contents |
|---|---|
| `### Highlights` | The 1–5 things worth the upgrade. Bold lead-in per bullet. Omit on a single-fix patch — the summary sentence already said it. |
| `### Added` | New capability. |
| `### Changed` | Different behaviour, dependency bumps, refactors with a user-visible rationale. |
| `### Fixed` | Bugs, each with the symptom the user actually saw. |
| `### Removed` | Deleted features, and any env var or setting that is no longer read. |
| `### Upgrade notes` | See below. Never omit when one applies. |
| `### Docs` / `### CI` / `### Tests` | Housekeeping worth recording, last. |

Close with the compare link:

```
**Full Changelog**: https://github.com/samuelloranger/rawkoon/compare/v1.9.5...v1.10.0
```

## Rules

- **Source the content from commit bodies, not commit subjects.**
  `git log --format='%s%n%b' <prev>..<tag>` — the substance lives in the body.
  Squashed PRs keep their per-commit messages there.
- **Write the symptom, not the patch.** "Library storage total reported roughly
  8192 TB" beats "cast SUM(size_bytes) to bigint". Keep the cause as the
  second clause when it explains the fix.
- **Keep the real numbers and names.** Contrast ratios, version pins, table and
  column names, cron schedules. They are why the notes are worth reading.
- **Reference issues and PRs inline** as `(#45)`, not as a separate link list.
- **Credit the reporter.** When a release closes an externally-filed issue,
  thank the person who opened it by handle near the top:
  `Both changes come from issues reported by @4thlabs — thank you.`
  Get the handle from `gh api repos/samuelloranger/rawkoon/issues/<n> -q .user.login`,
  never from memory.
- **Skip the screenshot commits.** `docs: update README screenshots [skip ci]`
  is pushed by `screenshots.yml` after every release and belongs in no release.
- **Skip the version bump commit** for the same reason.
- **Say nothing you did not verify.** If a commit body does not explain what a
  PR did, read the PR — do not invent a highlight.

## Upgrade notes — mandatory triggers

Add the section whenever the release contains any of:

- **A migration that renames or drops anything.** Say what the migration does,
  what existing rows end up with, and — critically — whether a code rollback to
  the previous image still works. It does not when a column was renamed: the
  old image queries a name that is gone, so recovery is a Postgres restore
  (`docs/deployment.md`), not repointing the image tag.
- **A dropped env var or setting.** Name it and say it is no longer read.
- **Data that is not migrated.** State it plainly (v1.8.0 dropped
  `book_progress` outright).
- **A feature gate.** Say what an install that leaves the gate off experiences.

## Backfilling many releases

Write each body to its own file, then loop — do not pass long bodies inline.

```bash
gh release edit v1.9.5 --title "v1.9.5 — …" --notes-file /path/v1.9.5.md
```

Watch for two traps:

- A quoted heredoc (`<<'EOF'`) does not expand `$VAR`, so a compare-URL
  variable lands in the file literally. Either use unquoted heredocs or
  `sed` the placeholder afterwards.
- Tag order is not always version order. `git describe --tags --abbrev=0 <tag>^`
  gives the real predecessor; rawkoon's `v1.8.0` spans the versions 1.8.1–1.8.6,
  which were bumped in `package.json` but never released. When a tag covers
  several unreleased versions, say so in the body.

## Verify

```bash
gh release list --limit 10   # titles alone should read as a changelog
```
