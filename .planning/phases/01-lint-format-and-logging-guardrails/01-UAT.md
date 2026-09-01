---
status: complete
phase: 01-lint-format-and-logging-guardrails
source: [01-VERIFICATION.md]
started: 2026-09-01T21:20:00Z
updated: 2026-09-01T22:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Forced-404 log redaction check on the simulator

expected: editionId, fileId, and status render as plain numbers in `log stream` output filtered on `subsystem == "cloud.samlo.rawkoon"` — not as `<private>`.
result: issue
reported: "Ran on macbuild's booted simulator (iPhone 14 Pro Max, iOS 26.2) against a real forced 404. No `Chapter download failed` line was emitted at all, so the redaction question could not be reached."
severity: major

How it was run — the check is now fully automatable and repeatable:

1. Hid `00 - Prologue .mp3` (book_files.id 26, edition 5) on the server, so its
   signed grant still verifies but `/api/books/files/26/content` 404s. Confirmed
   404 from both macbuild and inside the simulator; confirmed 200 again after
   restoring.
2. Built Debug on macbuild (`** BUILD SUCCEEDED **`), installed with `simctl
   install`, launched with `simctl launch` — never Xcode, so redaction stays on.
3. Signed in without credentials via the existing DEBUG `RAWKOON_TOKEN` autologin
   hook, using a bearer token minted from `ba_sessions`.
4. Started the download with the new DEBUG `RAWKOON_DOWNLOAD_EDITION=5` hook.

Result: `nsurlsessiond` requested `files/26/content` 12 times across the run, and
`log show --predicate 'subsystem == "cloud.samlo.rawkoon"'` returned **zero**
lines. The `Log.download.error` call in
`ChapterDownloader.urlSession(_:downloadTask:didFinishDownloadingTo:)` did not
fire for a 404 delivered through the background `URLSession`.

Not yet distinguished, and the next thing to establish: whether
`didFinishDownloadingTo` is simply not called for a non-2xx background download
(in which case the log call sits on a dead path and the real disposition belongs
in `didCompleteWithError`), or whether it is called and something earlier
returns. Until that is settled, ROADMAP criterion 4's live half is unproven —
the static half (privacy annotations present, credential scans clean) was
verified in 01-VERIFICATION.md and still holds.

### 2. Device play/pause/resume parity against v1.12.6

expected: Behavior is indistinguishable from v1.12.6 — same audio start, same pause/resume behavior, same Lock Screen info, no new error text anywhere.
result: issue
reported: "i had trouble selecting a chapter with 1.27... I was incapable of makint it play. I clicked and it wqs going to a chapter near ~23 and clicking back was not working either it was sometknes going to q chapter un the future"
severity: blocker

**Parity itself holds — this is NOT a phase-1 regression.** `git diff -w
--ignore-blank-lines v1.12.6..v1.12.7 -- 'apps/ios/**/*.swift'` shows every
change in the release is formatting (brace expansion, `_` for unused
parameters). The two `try?`→`do`/`catch` conversions in `AudiobookPlayer.swift`
(audio-session deactivation, artwork fetch) preserve control flow and condition
order. Nothing in the release touches seeking, the queue, or chapter selection.
The defect is present in v1.12.6 and earlier.

It is recorded here as an issue anyway, because it is a real blocker found
during this phase's UAT and must not be lost just because it predates the phase.

## Summary

total: 2
passed: 0
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "A chapter download that fails with a non-2xx status emits a Log.download.error line naming editionId, fileId and status in the clear"
  status: failed
  reason: "User reported: a real forced 404 on files/26 was requested 12 times and produced zero lines on subsystem cloud.samlo.rawkoon"
  severity: major
  test: 1
  root_cause: ""
  artifacts:
    - path: "apps/ios/Rawkoon/ChapterDownloader.swift"
      issue: "the non-2xx branch lives in didFinishDownloadingTo; it did not fire for a 404 on the background URLSession"
  missing:
    - "Establish whether didFinishDownloadingTo is called for a non-2xx background download, and dispose of the status in didCompleteWithError if it is not"
  debug_session: ""

- truth: "Tapping a chapter in the player starts that chapter, and the previous-chapter control moves backwards"
  status: failed
  reason: "User reported: incapable of making it play; clicking a chapter jumped to a chapter near ~23, and back sometimes went to a chapter in the future"
  severity: blocker
  test: 2
  pre_existing: true
  root_cause: "AudiobookPlayer.seekWhenReady handles a failed AVPlayerItem as `case .failed: isSeeking = false` — no log, no error text, no UI feedback. AVQueuePlayer then advances past unplayable items to the first that loads, so a tap lands on a later chapter. buildQueue compounds it: a chapter whose playbackURL is nil is skipped with `continue` while the queue still starts at the tapped index. Candidate triggers for an item failing: an expired seven-day grant, a local file whose size does not match the manifest, or a 404 like the one test 1 staged."
  artifacts:
    - path: "apps/ios/Rawkoon/AudiobookPlayer.swift"
      issue: "seekWhenReady swallows AVPlayerItem .failed with no log and no surfaced error (both the switch at ~603 and the KVO observer at ~618)"
    - path: "apps/ios/Rawkoon/AudiobookPlayer.swift"
      issue: "buildQueue skips a chapter with no playbackURL via `continue`, silently shifting where playback begins"
  missing:
    - "Log AVPlayerItem failure through Log.playback.error with the chapter identifier and the item's error"
    - "Surface an unplayable chapter to the user instead of silently landing on a different one"
    - "Decide whether a chapter with no playable URL should block the queue rather than be skipped"
  debug_session: ""
