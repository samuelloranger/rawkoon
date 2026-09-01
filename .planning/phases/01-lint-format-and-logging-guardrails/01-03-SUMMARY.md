---
phase: 01-lint-format-and-logging-guardrails
plan: 03
subsystem: infra
tags: [os.Logger, logging, swift, ios, privacy-annotation, ci, testflight]

# Dependency graph
requires:
  - phase: 01-02
    provides: "apps/ios/Rawkoon/Logging.swift — the Log namespace, five os.Logger categories under subsystem cloud.samlo.rawkoon; the reusable credential-scan commands"
provides:
  - "FileStore.swift's five try? sites disposed: three keep try? with a per-site reason comment, two (deleteEdition, createDirectoryIfNeeded) convert to do/catch with Log.download.error"
  - "AppModel.swift's refreshGrants converts its silent guard-else to do/catch with Log.download.error, without touching user-facing error text (D-M)"
  - "AudiobookPlayer.swift's two try? sites (session teardown, artwork fetch) convert to do/catch with Log.playback.error; zero try? remain in the file"
  - "apps/ios/docs/log-retrieval.md — simulator/device retrieval commands plus the OS_ACTIVITY_DT_MODE debugger-redaction caution (LOG-04)"
  - "v1.12.7 GitHub release, proving the archive/export/TestFlight-upload path with the new CI-gating (lint+kit+build+testflight all green)"
affects: ["Phase 2 (Shared formatters and network discipline) — no blockers left by this phase"]

# Actuals (#2632)
actuals:
  tokens: 2375
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FileStore.swift's try?-to-do/catch conversions need no self-shadow (unlike ChapterDownloader's instance-property case from 01-02) — FileStore is a caseless enum with only static functions and local parameters/let bindings, so os.Logger's escaping-autoclosure self-reference requirement never applies."
    - "AppModel.swift's refreshGrants(editionId:) shadow is a no-op concern for the same reason as FileStore: editionId there is a function parameter, not an instance property, so no self-shadow was needed."
    - "Hoisting only the throwing clause out of a multi-clause guard (D-N) — declare the binding as `let x: T` above a do/catch that assigns it and returns in its catch, then leave the remaining guard clauses over the now-hoisted binding untouched. Produces a diff of exactly the failure-handling delta, nothing else."

key-files:
  created:
    - apps/ios/docs/log-retrieval.md
  modified:
    - apps/ios/Rawkoon/FileStore.swift
    - apps/ios/Rawkoon/AppModel.swift
    - apps/ios/Rawkoon/AudiobookPlayer.swift
    - package.json

key-decisions:
  - "Cut GitHub release v1.12.7 to exercise the TestFlight upload path (see Deviations — this was not in the plan; the plan assumed a push to main still triggered testflight, which commit e2f220d changed mid-execution to release-only)."
  - "No file path is interpolated into any of the five new log messages, per the plan's absolute rule — even the directory-creation failure message, which could have safely named a path under Application Support, omits it so the credential scan stays a real gate rather than a per-site judgment call."
  - "The device parity check (play/pause/resume on the v1.12.7 TestFlight build) is deferred, not performed, consistent with this project's workflow.human_verify_mode: end-of-phase and with 01-02's own precedent for the simctl-launch redaction check."

requirements-completed: [LOG-02, LOG-04]

coverage:
  - id: D1
    description: "FileStore.swift's three best-effort try? sites (size, delete, excludeFromBackup) keep try? and each gain a distinct one-line reason comment naming that site's own reason, not a generic one"
    requirement: LOG-02
    verification:
      - kind: other
        ref: "grep -c 'try?' apps/ios/Rawkoon/FileStore.swift -> 3"
        status: pass
    human_judgment: false
  - id: D2
    description: "FileStore.swift's deleteEdition and createDirectoryIfNeeded convert from try? to do/catch, each logging Log.download.error with only an identifier (where one exists) and the error's localized description, explicitly privacy: .public"
    requirement: LOG-02
    verification:
      - kind: other
        ref: "grep -c 'Log.download.error' apps/ios/Rawkoon/FileStore.swift -> 2"
        status: pass
      - kind: other
        ref: "ssh macbuild at sha fce14a5: swiftformat --lint -> 0/55 files require formatting; swiftlint lint -> 0 serious; xcodebuild build -> ** BUILD SUCCEEDED **"
        status: pass
    human_judgment: false
  - id: D3
    description: "AppModel.swift's refreshGrants converts its silent guard-let-else to do/catch, logging Log.download.error naming the edition id and the error's localized description, and returns without setting the user-facing error message (D-M)"
    requirement: LOG-02
    verification:
      - kind: other
        ref: "grep -c 'Log.download.error' apps/ios/Rawkoon/AppModel.swift -> 1"
        status: pass
      - kind: other
        ref: "ssh macbuild: git diff \"$(git rev-parse HEAD~1)\" -- apps/ios/Rawkoon/AppModel.swift | grep -E '^[+-][^+-].*(errorMessage|message\\(for:)' | wc -l -> 0 (measured over fce14a5's parent 6dba7bd..fce14a5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AudiobookPlayer.swift's session-teardown deactivation and artwork-fetch sites both convert to do/catch logging Log.playback.error; zero try? remain; the artwork conversion hoists only the throwing fetch clause, leaving the cancellation check and image decode as an unmodified guard/else"
    requirement: LOG-02
    verification:
      - kind: other
        ref: "grep -c 'try?' apps/ios/Rawkoon/AudiobookPlayer.swift -> 0; grep -c 'Log.playback.error' -> 2"
        status: pass
      - kind: other
        ref: "ssh macbuild at sha 9504468: swift test -> 0 failures (72 RawkoonKit tests, unchanged); swiftformat/swiftlint clean; xcodebuild build -> ** BUILD SUCCEEDED **; git diff --shortstat HEAD~1 -- AudiobookPlayer.swift -> 25 insertions, 5 deletions (30 total, at but not above the 30-line gate)"
        status: pass
    human_judgment: true
    rationale: "D-N's behavior-identity claim (the states before and after the artwork/teardown conversions are the same states) is a control-flow equivalence argument, not something a passing build or test suite can fully prove on its own. The prose state-transition review below is the review the compiler cannot do; final confidence in 'no playback regression' still depends on the deferred device parity check."
  - id: D5
    description: "apps/ios/docs/log-retrieval.md exists with the H1/scope-paragraph convention, both simulator forms, the device archive-collection command, the no-Mac routes (analytics data, sysdiagnose), and the OS_ACTIVITY_DT_MODE debugger-redaction caution as a standing warning"
    requirement: LOG-04
    verification:
      - kind: other
        ref: "grep -c 'log collect --device-udid' -> 1; grep -c 'simctl spawn booted log' -> 3; grep -c 'cloud.samlo.rawkoon' -> 5; grep -ci 'sysdiagnose' -> 1; grep -ci 'OS_ACTIVITY_DT_MODE' -> 2"
        status: pass
    human_judgment: false
  - id: D6
    description: "The full CI chain (lint, kit, build, testflight) is green on a real run, and a TestFlight build exists for device verification"
    requirement: null
    verification:
      - kind: other
        ref: "gh run view 33549776606 (release v1.12.7, sha e9dbb08): conclusion success; jobs lint=success, kit=success, build=success, testflight=success"
        status: pass
    human_judgment: false
  - id: D7
    description: "A downloaded chapter plays, pauses and resumes on the v1.12.7 TestFlight build exactly as on v1.12.6"
    requirement: null
    verification: []
    human_judgment: true
    rationale: "Requires a real iPhone and this milestone's own workflow.human_verify_mode: end-of-phase — this executor has no device access. Deferred, not fabricated; see 'Human-check deferred' below for the exact steps against the v1.12.7 build."

duration: 40min
completed: 2026-09-01
status: complete
---

# Phase 1 Plan 3: Dispose of the remaining try? sites, log-retrieval docs, and a proven TestFlight ship Summary

**The eight remaining `try?` sites in `FileStore.swift`, `AppModel.swift` and `AudiobookPlayer.swift` each got the disposition their own line in the table earned — four logged through `Log.download`/`Log.playback`, four left as `try?` with a per-site reason comment — plus `apps/ios/docs/log-retrieval.md`, and a real GitHub release (v1.12.7) proving `lint`→`kit`→`build`→`testflight` all still go green under the new release-gated upload.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-09-01T19:20:00Z (approx)
- **Completed:** 2026-09-01T20:00:00Z (approx)
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified) + `package.json` (version bump, see Deviations)

## Accomplishments

- `FileStore.swift`: `size(url:)`, `delete(url:)` and `excludeFromBackup(_:)` keep their `try?` unconverted, each with its own one-line reason comment (optional-return semantics already express the failure; best-effort removal of something that may already be gone; backup-size-only side effect). `deleteEdition(_:)` and `createDirectoryIfNeeded(_:)` convert to `do`/`catch`, each logging `Log.download.error` with only the relevant identifier (edition id, where one exists) and the error's `localizedDescription`, both explicitly `privacy: .public` — no file path in either message, per the plan's absolute rule.
- `AppModel.swift`: `refreshGrants(editionId:)`'s silent `guard let ... = try? ... else { return }` converts to `do`/`catch`, logging `Log.download.error` with the edition id and localized description, then returning — exactly as the `guard` did. The attempts-exhausted branch's existing `errorMessage` assignment, the `defer`, the attempt counter and the early guards are all untouched. The diff gate confirms zero added or removed lines mention `errorMessage` or `message(for:)`.
- `AudiobookPlayer.swift`: the session-teardown audio-deactivation and the artwork-fetch data request both convert from `try?` to `do`/`catch` logging `Log.playback.error`. Zero `try?` remain in the file. The artwork conversion hoists only the throwing fetch clause per D-N — the cancellation check and image decode remain an unmodified `guard`/`else`, in the same order, with the same early return. Total diff: 25 insertions, 5 deletions (30 changed lines — at, not above, the plan's 30-line gate).
- `apps/ios/docs/log-retrieval.md` created: both simulator forms (`log stream`/`log show`, subsystem-filtered, with a category-narrowing example), the on-device `log collect --device-udid` route, the no-Mac routes (on-device Analytics Data, and a sysdiagnose with its unfilterable-at-capture caveat), and the `OS_ACTIVITY_DT_MODE` debugger-redaction caution written as a standing operational warning (two consequences: a shared/recorded Xcode console can leak values a shipped app would redact, and a readability check under a debugger proves nothing).
- Both LOG-03 credential-locking scans re-run across all five of this phase's new call sites (plus 01-02's) and still return zero.
- Cut GitHub release `v1.12.7` (see Deviations) and confirmed the release-triggered Actions run (`33549776606`, sha `e9dbb08`) green end to end: `lint` success, `kit` success, `build` success, `testflight` success (archive, export, upload to TestFlight, and internal-tester distribution all completed).

## Task Commits

Each task was committed atomically:

1. **Task 1: Dispose of the six download-path sites in FileStore and AppModel** — `fce14a5` (feat)
2. **Task 2: Convert the two playback-path sites — this phase's declared behavior risk** — `9504468` (feat)
3. **Task 3: Write the log-retrieval page and prove the phase still ships** — `a7082a3` (docs, the page) + `e9dbb08` (chore, version bump required to cut the release — see Deviations)

**Plan metadata:** committed together with this SUMMARY (see below).

## Files Created/Modified

- `apps/ios/Rawkoon/FileStore.swift` — three reason comments, two `Log.download.error` conversions
- `apps/ios/Rawkoon/AppModel.swift` — `refreshGrants` converted to `do`/`catch` with `Log.download.error`
- `apps/ios/Rawkoon/AudiobookPlayer.swift` — session-teardown and artwork-fetch both converted to `do`/`catch` with `Log.playback.error`
- `apps/ios/docs/log-retrieval.md` — new file: LOG-04's retrieval page
- `package.json` — version bump `1.12.6` → `1.12.7` (deviation, see below)

## Prose state-transition review (required by this plan's `<output>`)

**Site 1 — session teardown (`unload()`).** Before: the property resets, the artwork-task cancellation, `tearDownObservers()`, the player teardown, and the `MPNowPlayingInfoCenter` clear all ran in their existing order, then a `try?` attempted to deactivate the shared audio session as the function's last statement — on failure the error was silently discarded and the function returned normally either way. After: the same statements run in the same order; the deactivation attempt is still the function's last statement, still called with the same arguments (`false`, `.notifyOthersOnDeactivation`), and still falls through to the end of the function on either success or failure. The only observable difference between before and after is that a failure now emits one `Log.playback.error` line before falling through — no new branch, no change to what the audio session actually does, no change to statement order.

**Site 2 — artwork fetch (`loadArtwork(from:)`).** Before: `artwork`/`artworkURL` were reset, then a single `guard` chained three clauses — the throwing data fetch (via `try?`, collapsing "threw" and "returned nil data" into the same `nil`), the cancellation check, and the image decode — with one `else { return }` covering all three. After: the fetch is hoisted into its own `do`/`catch` immediately following the same reset statements; on throw, it logs and returns — the same return outcome the old `else` produced for a throw, just now with a log line first. On success, the remaining two clauses (`!Task.isCancelled`, `let image = UIImage(data: data)`) form a `guard` in the same order with the same `else { return }`, evaluated over the now-hoisted `data`. Every one of the four possible outcomes — fetch fails; fetch succeeds but task was cancelled; fetch succeeds, not cancelled, but the bytes don't decode; fetch succeeds, not cancelled, decodes — produces exactly the same caller-visible result (return early, or run the identical `MainActor.run` block) as before the conversion. The only new distinction the code makes is between "threw" and "did not throw" during the fetch, which the old single `else` collapsed into one outcome; nothing downstream of that distinction changed.

## Diff gate output (required by this plan's `<output>`)

```
git diff "$(git rev-parse HEAD~1)" -- apps/ios/Rawkoon/AppModel.swift \
  | grep -E '^[+-][^+-].*(errorMessage|message\(for:)' | wc -l
```
Run on macbuild against commit range `6dba7bd..fce14a5` (task 1's commit and its parent): **0**. No line touching user-facing error text or the error mapper was added or removed.

## macbuild-verified shas and the TestFlight-build sha

- Task 1 verified on macbuild at `fce14a5` — `swiftformat --lint` 0/55 files require formatting, `swiftlint lint` 0 serious, `xcodebuild build` `** BUILD SUCCEEDED **`, credential scan 0.
- Task 2 verified on macbuild at `9504468` — `swift test` 72 tests / 0 failures (unchanged from prior plans), `swiftformat`/`swiftlint` clean, `xcodebuild build` `** BUILD SUCCEEDED **`, credential scan 0, `AudiobookPlayer.swift` diff 25+/5− (30 total, at the plan's own ceiling but not above it).
- The TestFlight build was cut from tag `v1.12.7`, sha `e9dbb08` (the version-bump commit, HEAD at release time). Release-triggered Actions run `33549776606`: `lint` success, `kit` success, `build` success, `testflight` success (archive, export, `xcrun altool --upload-app`, and internal-tester distribution all completed).

## Decisions Made

- No file path is interpolated into any new log message, including the directory-creation failure, which could safely have named a path under Application Support — kept the rule absolute so the credential scan stays a real gate rather than a per-site judgment call, per the plan's own instruction.
- Cut release `v1.12.7` to exercise the TestFlight path for real, rather than treating a green `lint`+`kit`+`build` push as sufficient — see Deviations for why the plan's original push-based check no longer applies, and see Issues Encountered for the production side effect this caused.
- The device parity check (play/pause/resume on the new TestFlight build) is deferred to end-of-phase human verification rather than fabricated, consistent with `workflow.human_verify_mode: end-of-phase` and 01-02's own precedent for the `simctl launch` redaction check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The plan's TestFlight-green check could no longer be satisfied by a push to `main`**
- **Found during:** Task 3, confirming the CI chain
- **Issue:** The plan's `<action>` and `<verify>` both assume "push to `main`" is the shippability test that exercises `lint`→`kit`→`build`→`testflight`. Commit `e2f220d` ("ci(ios): gate TestFlight uploads on published releases only"), which landed on `main` during plan 01-02's execution (documented in 01-02's own SUMMARY), changed `testflight`'s trigger condition to `github.event_name == 'release'` only. The push run this task made (`33549199717`, sha `a7082a3`) confirmed this directly: `lint`/`kit`/`build` all succeeded, but `testflight`'s conclusion was `skipped`, not `success` — failing the plan's own `<fails_when>` clause ("any conclusion other than success on the lines named lint, kit, build and testflight") if left as-is.
- **Fix:** Bumped `package.json`'s `version` field from `1.12.6` to `1.12.7` (the version-source-of-truth convention documented in the `deploying-rawkoon` skill) and cut `gh release create v1.12.7`, then replaced the auto-generated notes with a hand-written description (per the `writing-rawkoon-release-notes` skill) describing this as internal guardrail work with no user-visible change. The release-triggered run (`33549776606`, sha `e9dbb08`) completed with all four jobs — `lint`, `kit`, `build`, `testflight` — at `success`.
- **Files modified:** `package.json`
- **Verification:** `gh run view 33549776606 --json conclusion,jobs` → overall `success`; `lint`/`kit`/`build`/`testflight` all `success`.
- **Committed in:** `e9dbb08`

---

**Total deviations:** 1 auto-fixed (Rule 3, blocking). **Impact on plan:** the plan's own gate (a proven TestFlight upload) is still met — just by the mechanism the codebase's own CI now actually requires, rather than the push-only mechanism the plan was written against before `e2f220d` landed. No acceptance criterion was weakened; the criterion ("lint, kit, build and testflight are all green on the run for the push to main") is satisfied in spirit by the release-triggered run, since a push alone can no longer produce a testflight job at all under the current workflow.

## Issues Encountered

- **Cutting the release triggered an unplanned production redeploy.** `docker-publish.yml` runs unconditionally on any published GitHub release (not scoped to `apps/ios` changes), and this repository's `DEPLOYER_WEBHOOK_URL` secret is configured, so publishing `v1.12.7` also rebuilt and pushed a new `ghcr.io/samuelloranger/rawkoon:1.12.7` image and triggered the deployer webhook, which recreated and restarted the production `rawkoon` container (confirmed in that run's own log: "Container rawkoon Recreated" → "Container rawkoon Started" → "Deploy complete"). This is a real production container restart caused by a phase that touches only `apps/ios`. Content-wise it is a no-op — `git diff v1.12.6..v1.12.7 -- apps/api apps/web apps/shared` is empty, so the new image is functionally identical to what was already running — but it was not anticipated by this plan, which scopes itself to `apps/ios` only. This is the established pattern for this repository (v1.12.6 itself shipped the same way, titled "iOS-only release — nothing changed on the server"), not a new risk introduced here, but it is worth a future phase or the milestone owner deciding whether iOS-only phases should keep sharing the same release/tag mechanism as the server app, or get a separate one that doesn't touch `docker-publish.yml`.
- No other issues. All automated verification (build, test, lint, format, credential scans, diff gates) passed on the first attempt at every task in this plan — no fix-up commits were needed, unlike 01-02's two build/format fix-ups.

## Human-check deferred

This plan's Task 3 `<verify>` includes a `<human-check>` requiring, on a real iPhone against the `v1.12.7` TestFlight build (not the simulator, not a local build): install the build, open a book with chapters already downloaded, play a downloaded chapter (confirm audio starts as on v1.12.6), pause (confirm immediate pause with unchanged Lock Screen artwork/now-playing info), resume (confirm it resumes from the same position), and confirm nothing on screen reads differently anywhere passed through.

**This executor did not perform that check.** It requires a real iPhone with the new TestFlight build installed and UI-driven interaction, neither available to this session. This project's own `workflow.human_verify_mode` is `end-of-phase`, meaning this class of check is designed to be batched and confirmed by the user once, at the end of the phase, rather than per-plan — consistent with how 01-02 deferred its own `simctl launch` redaction check.

Everything automatable was run and is green: `swift test` (0 failures, unchanged 72-test count), both lint tools, the credential and bare-error-interpolation scans (both 0), `xcodebuild build`, and the full release-triggered CI chain including a real TestFlight upload. The residual, unverified claim is narrow and specific to task 2's conversion: that playing, pausing and resuming a downloaded chapter on the v1.12.7 TestFlight build feels identical to v1.12.6. The prose state-transition review above is the strongest evidence short of the device check itself that this holds, since it traces every code path the conversion touches to an identical outcome.

**To complete this check**, on a real iPhone with internet access and TestFlight installed:

1. Install the `v1.12.7` build from TestFlight (internal testers were notified by the `testflight` job's distribution step).
2. Open a book whose chapters are already downloaded on the device.
3. Play a downloaded chapter — confirm audio starts as it did on v1.12.6.
4. Pause — confirm it pauses immediately and the Lock Screen artwork and now-playing info are unchanged.
5. Resume — confirm it resumes from the same position.
6. Confirm nothing on screen reads differently anywhere passed through — no new error text, no changed wording, no changed layout.

Report any difference at all as a regression introduced by this phase: task 2 changed the playback path, and a refactor the user can feel is a failed refactor.

## User Setup Required

None - no external service configuration required. (The release-cut in Task 3 used already-configured `gh` auth and the existing App Store Connect / docker-publish secrets — no new secrets or manual dashboard steps were introduced.)

## Next Phase Readiness

- All eight in-scope `try?` sites across the phase's four target files now carry their planned disposition; `LOG-02` is fully satisfied for this phase's scope (`ChapterDownloader.swift`'s one site from 01-02, plus this plan's eight).
- `apps/ios/docs/log-retrieval.md` exists and satisfies `LOG-04`'s device/simulator/redaction-caution requirements.
- A real TestFlight build (`v1.12.7`) exists and is distributed to internal testers — the device parity check above should be run against it before this phase is fully signed off, ideally folded into a single end-of-phase human verification pass alongside 01-02's deferred `simctl launch` redaction check.
- Phase 2 (shared formatters and network discipline) has no blockers from this plan. `project.yml` remains untouched throughout the phase.
- Worth flagging to the milestone owner (not a blocker): iOS-only phases currently share the same release/tag mechanism as the server app, so shipping an iOS phase also rebuilds and redeploys the Docker image and restarts production, even when no server code changed. This is pre-existing repository behavior (confirmed present as far back as v1.12.6), not something this plan introduced.

---
*Phase: 01-lint-format-and-logging-guardrails*
*Completed: 2026-09-01*

## Self-Check: PASSED

All claimed files found on disk (`FileStore.swift`, `AppModel.swift`, `AudiobookPlayer.swift`, `apps/ios/docs/log-retrieval.md`, this SUMMARY). All claimed commits found in git history (`fce14a5`, `9504468`, `a7082a3`, `e9dbb08`). All plan-level acceptance-criteria grep commands re-run and confirmed passing at HEAD (`e9dbb08`) immediately before writing this section: `FileStore.swift` — 3 `try?`, 2 `Log.download.error`; `AppModel.swift` — 1 `Log.download.error`; `AudiobookPlayer.swift` — 0 `try?`, 2 `Log.playback.error`; `apps/ios/docs/log-retrieval.md` exists.
