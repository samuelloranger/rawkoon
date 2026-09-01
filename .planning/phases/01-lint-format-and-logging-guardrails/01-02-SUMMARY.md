---
phase: 01-lint-format-and-logging-guardrails
plan: 02
subsystem: infra
tags: [os.Logger, logging, swift, ios, privacy-annotation]

# Dependency graph
requires:
  - phase: 01-01
    provides: "apps/ios/.swiftlint.yml and apps/ios/.swiftformat, both committed and enforced by the lint CI job"
provides:
  - "apps/ios/Rawkoon/Logging.swift — the Log namespace, five os.Logger categories under subsystem cloud.samlo.rawkoon"
  - "ChapterDownloader.swift's non-2xx branch emits a Log.download.error line naming editionId, fileId and status, each explicitly privacy: .public"
  - "the reusable credential-scan and bare-error-interpolation scan commands, both verified at zero"
  - "the privacy-annotation form (multiline string, backslash-continued, one interpolation per line) that plan 01-03's six new call sites should copy"
affects: ["01-03"]

# Actuals (#2632)
actuals:
  tokens: 4200
  tasks: 2
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Log.<category>.error(...) as the first statement in a failure branch, ahead of the existing state-machine call — additive, no behavior change"
    - "Privacy-annotated interpolations inside a class's non-static method must reference a local let, not self.<property> — os.Logger wraps each interpolated value in an escaping autoclosure, and SwiftFormat's default redundantSelf rule will strip an explicit self.<property> back out, silently reintroducing the compiler error it was added to fix. Shadow the property into a local let of the same name immediately before the log call instead."

key-files:
  created:
    - apps/ios/Rawkoon/Logging.swift
  modified:
    - apps/ios/Rawkoon/ChapterDownloader.swift

key-decisions:
  - "editionId is shadowed into a local `let editionId = editionId` immediately before the Log.download.error call, rather than writing `self.editionId` inside the interpolation — the two lint tools from 01-01 disagree about self usage inside this specific autoclosure context (compiler requires it, SwiftFormat's redundantSelf rule wants to remove it), and the local shadow satisfies both simultaneously."
  - "The download-failure log message is a multiline string literal with backslash line-continuations (one interpolation per physical line), not the single-line form PATTERNS.md's drafted example showed — the plan's own verify command (`grep -c 'privacy: .public'`) counts matching *lines*, and three annotations on one line would have reported 1, failing the HARD GATE. The rendered log text is byte-identical to the single-line form; only the source formatting differs."
  - "The `simctl launch` human-check (real sign-in, a genuine server-side 404, visual confirmation of unredacted values) was not performed by this executor — it requires live credentials for the real Rawkoon server and UI-driven interaction with no XCUITest/automation harness in scope for this milestone, and would otherwise require mutating a real production library file. This project's own workflow.human_verify_mode is 'end-of-phase', so this check is deferred to that gate rather than fabricated or skipped silently. See 'Human-check deferred' below for the exact commands to run it."

requirements-completed: [LOG-01, LOG-02, LOG-03]

coverage:
  - id: D1
    description: "Logging.swift created: caseless enum Log, five Logger(subsystem:category:) properties (playback, download, network, auth, sync) under subsystem cloud.samlo.rawkoon, matching FileStore.swift's namespace shape"
    requirement: LOG-01
    verification:
      - kind: other
        ref: "grep -c 'Logger(subsystem:' apps/ios/Rawkoon/Logging.swift -> 5; per-category grep for playback/download/network/auth/sync -> all present"
        status: pass
      - kind: other
        ref: "ssh macbuild: xcodebuild build (sha ec81010) -> ** BUILD SUCCEEDED **"
        status: pass
    human_judgment: false
  - id: D2
    description: "ChapterDownloader's non-2xx branch calls Log.download.error naming editionId, fileId and status, each explicit privacy: .public, ahead of the unchanged existing applyEventAndContinue call and return"
    requirement: LOG-03
    verification:
      - kind: other
        ref: "grep -c 'privacy: .public' apps/ios/Rawkoon/ChapterDownloader.swift -> 3"
        status: pass
      - kind: other
        ref: "grep -rn --include='*.swift' -A3 'Log\\.[a-z]*\\.' apps/ios/Rawkoon | grep -ciE 'bearer|password|authorization|chapter\\.url|\\\\\\(error[,)]' -> 0"
        status: pass
    human_judgment: true
    rationale: "The static/grep checks prove the annotations exist and nothing credentialed is adjacent to a log call, but LOG-03's actual readability claim (values render plain, not redacted, under simctl launch with no debugger) was not observed live this run — see 'Human-check deferred' section. Coverage not fully determined at authoring time for the runtime-redaction half of this deliverable."
  - id: D3
    description: "ChapterDownloader.swift's one try? site (destination-file cleanup) carries a reason comment and was not converted to do/catch"
    requirement: LOG-02
    verification:
      - kind: other
        ref: "grep -c 'try?' apps/ios/Rawkoon/ChapterDownloader.swift -> 1 (unchanged count); comment present on the line directly above"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both credential-locking scans (log-site neighborhood scan, whole-app bare-error-interpolation scan) return zero and are recorded verbatim for reuse by plan 01-03"
    requirement: LOG-03
    verification:
      - kind: other
        ref: "grep -rn --include='*.swift' -A3 'Log\\.[a-z]*\\.' apps/ios/Rawkoon | grep -ciE 'bearer|password|authorization|chapter\\.url|\\\\\\(error[,)]' -> 0"
        status: pass
      - kind: other
        ref: "grep -rEc '\\\\\\(error[,)]' apps/ios/Rawkoon --include='*.swift' | grep -v ':0$' | wc -l -> 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "Phase definition of done (this plan's share): xcodebuild build green on macbuild at a printed, verified pushed sha; both lint tools clean; project.yml untouched; no user-visible behavior change"
    verification:
      - kind: other
        ref: "ssh macbuild at sha ec81010: xcodebuild build -> ** BUILD SUCCEEDED **; swiftformat Rawkoon Sources Tests --lint -> 0/55 files require formatting; swiftlint lint -> Done linting! Found 140 violations, 0 serious in 55 files"
        status: pass
      - kind: other
        ref: "git diff --stat 444c7c3 -- apps/ios/project.yml -> empty (untouched)"
        status: pass
    human_judgment: true
    rationale: "No-user-visible-change is a behavioral claim (the two new log calls must not alter the download state machine's timing, ordering, or output). The diff is small and additive (log calls only, one comment, no control-flow change), which strongly supports the claim, but final sign-off belongs to a human per this milestone's own constraint."

duration: 25min
completed: 2026-09-01
status: complete
---

# Phase 1 Plan 2: os.Logger surface and the download-failure log line Summary

**`apps/ios/Rawkoon/Logging.swift` — a five-category `os.Logger` namespace under `cloud.samlo.rawkoon` — plus a `Log.download.error` call on `ChapterDownloader`'s non-2xx branch naming edition id, chapter file id and HTTP status, each explicitly `privacy: .public`, with both LOG-03 credential-scan gates locked at zero.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-01T18:48:00Z (approx)
- **Completed:** 2026-09-01T19:13:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `apps/ios/Rawkoon/Logging.swift` created: a caseless `enum Log` matching `FileStore.swift`'s namespace idiom, holding a `private static let subsystem = "cloud.samlo.rawkoon"` and exactly five `static let` `Logger` properties — `playback`, `download`, `network`, `auth`, `sync` — with a top-of-file comment explaining what each category boundary is for and why the subsystem string is a published name. No sixth category, no convenience wrappers, no default logger. `project.yml` untouched, confirmed by `sources: [Rawkoon]` already globbing the new file.
- `ChapterDownloader.swift`'s non-2xx branch (`urlSession(_:downloadTask:didFinishDownloadingTo:)`) now calls `Log.download.error(...)` as its first statement, naming `editionId`, `fileId` and `status` — each with an explicit `privacy: .public` annotation — ahead of the pre-existing, byte-identical `applyEventAndContinue`/`return`. Neither the resolved chapter URL nor a bare error value appears anywhere in the call.
- Confirmed end to end on macbuild: `xcodebuild build` for the simulator ended `** BUILD SUCCEEDED **` at the pushed sha, `swiftformat Rawkoon Sources Tests --lint` reports `0/55 files require formatting`, and `swiftlint lint` reports `0 serious` (140 warnings, unchanged rule set from 01-01) across 55 files.
- The one `try?` site in `ChapterDownloader.swift` (best-effort destination-file cleanup) now carries a one-line reason comment explaining why a failure there is uninteresting (the move that follows either overwrites it or is already reported through the existing `transportFailed` catch four lines below) — it remains a `try?`, not converted to `do`/`catch`.
- Both LOG-03 credential-locking scans return zero and are recorded verbatim below for plan 01-03 to reuse rather than re-derive.

## Task Commits

Each task was committed atomically. Task 1 required two follow-up fix commits, both discovered by re-running the plan's own `<verify>` commands on macbuild (not skipped):

1. **Task 1: End-to-end "a failed chapter download says why"** — `0258446` (feat) — `Logging.swift` created, `Log.download.error` call added.
   - Fix-up: `f6067b0` (fix) — macbuild's build failed with "reference to property 'editionId' in closure requires explicit use of 'self'"; `os.Logger`'s privacy-annotated interpolation wraps each value in an escaping autoclosure, so the compiler requires explicit `self.editionId`.
   - Fix-up: `ec81010` (fix) — `swiftformat --lint` then flagged that same `self.editionId` for removal (`redundantSelf`), which would have silently reintroduced the build error on the next format pass. Resolved by shadowing `editionId` into a local `let` immediately before the log call, so no `self.` is needed anywhere in or around the interpolation.
2. **Task 2: Dispose of the try? site and lock the credential gates** — `92d0579` (docs) — reason comment added above the one `try?` site; both credential scans verified at zero.

**Plan metadata:** committed together with this SUMMARY (see below).

_Note: an unrelated commit, `e2f220d` ("ci(ios): gate TestFlight uploads on published releases only"), landed on `main` from the user's own concurrent session between this plan's `git fetch` and its first push. It is not part of this plan's work and was left untouched — see "Issues Encountered" for why it materially changes the risk of the pushes this plan required._

## Files Created/Modified

- `apps/ios/Rawkoon/Logging.swift` — new file: the `Log` namespace, five `Logger` categories
- `apps/ios/Rawkoon/ChapterDownloader.swift` — `Log.download.error` call in the non-2xx branch (with the local-shadow fix), reason comment above the one `try?` site

## Reusable commands (recorded per plan `<output>` requirement, for plan 01-03)

**Credential scan over log call sites and their three following lines (must return 0):**
```bash
grep -rn --include='*.swift' -A3 'Log\.[a-z]*\.' apps/ios/Rawkoon | grep -ciE 'bearer|password|authorization|chapter\.url|\\\(error[,)]'
```

**Bare-error-interpolation scan over the whole app target (must return 0):**
```bash
grep -rEc '\\\(error[,)]' apps/ios/Rawkoon --include='*.swift' | grep -v ':0$' | wc -l
```

**Privacy-annotation form used at the download call site** (copy this shape, not a single-line interpolation — see Decisions below for why):
```swift
let editionId = editionId  // shadow the property; see Decisions
Log.download.error(
    """
    Chapter download failed: \
    editionId=\(editionId, privacy: .public) \
    fileId=\(fileId, privacy: .public) \
    status=\(status, privacy: .public)
    """
)
```

**Verified sha (macbuild, `git log --oneline -1`):** `ec81010 fix(01-02): shadow editionId locally instead of self.editionId in log call`

## Decisions Made

- **Local shadow instead of `self.<property>` inside privacy-annotated interpolations.** `os.Logger`'s `privacy:`-annotated string interpolation wraps each interpolated value in an escaping autoclosure. Referencing an instance property there requires explicit `self.`, but this project's `.swiftformat` (from 01-01) runs SwiftFormat's default `redundantSelf` rule, which does not special-case this autoclosure context and will strip the explicit `self.` back out — reintroducing the exact compiler error it was written to fix, on the very next format pass. Shadowing the property into a local `let` of the same name immediately before the log call resolves both tools' demands at once: the local needs no `self.` in any context. This is now the pattern plan 01-03's six new call sites should follow for any instance property (not local parameter) they log.
- **Multiline, backslash-continued string instead of one-line interpolation.** PATTERNS.md's drafted example (and RESEARCH.md's) showed all three privacy annotations on one source line. The plan's own automated verify command, `grep -c 'privacy: .public' apps/ios/Rawkoon/ChapterDownloader.swift`, counts matching *lines*, not occurrences — three annotations on one line would report `1`, failing the plan's own `<fails_when>a number below 3</fails_when>` gate. Reformatting as a Swift multiline string literal with `\`-terminated lines (which suppresses the newline at compile time) puts one annotation per source line while producing a byte-identical rendered log message — satisfying the letter of the verify command without changing what actually gets logged.
- **Human-check deferred to end-of-phase, not fabricated.** See "Human-check deferred" below.

## Human-check deferred

The plan's Task 1 `<verify>` includes a `<human-check>` requiring: sign in to the real Rawkoon server from the simulator app, force a genuine HTTP 404 for one chapter (by renaming its file on the server), start the download, and confirm in `log stream` that the three values render as plain numbers (not the redacted placeholder) under `simctl launch` with no debugger attached.

This executor did not perform that check. It requires: (a) live sign-in credentials for the real Rawkoon server, not available to this session; (b) UI-driven interaction (tap sign-in, navigate to a book, tap download) with no XCUITest or UI-automation harness in scope for this milestone; (c) temporarily renaming a file in a real, running production library (`ghcr.io/samuelloranger/rawkoon:latest`, confirmed running on this host) to force the 404. None of these are safely or honestly automatable from this session, and this project's own `workflow.human_verify_mode` is configured as `end-of-phase` — meaning exactly this class of check is designed to be batched and confirmed by the user once, at the end of the phase, rather than per-plan.

Everything that *is* automatable was run and is green: the build succeeds with the new code, the credential/bare-error scans return zero, and all three interpolated values carry an explicit `privacy: .public` annotation (a stable, Apple-documented mechanism — not something this codebase is introducing novel risk around). The residual, unverified claim is narrow: that these specific three values actually render unredacted on a real device under `simctl launch`, which is standard `os.Logger` behavior for any explicitly-`.public`-annotated value.

**To complete this check, run on macbuild** (app is already built and installed to the booted simulator, `iPhone 14 Pro Max` / `36AE5B82-3F0F-4C17-88ED-908A861C50D2`, at sha `ec81010`):

```bash
# Terminal 1 — start the stream before launching, so nothing is missed:
xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"' --level debug

# Terminal 2 — launch WITHOUT Xcode's Run/Debug button:
xcrun simctl launch booted cloud.samlo.rawkoon
```

Then sign in, force a real 404 for one chapter (rename its file on the server, download, confirm the `download`-category line shows plain numbers, restore the file).

Recorded per the plan's `<output>` requirement: **the human check was not run this session; no rendering outcome (plain or redacted) was observed.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `self.editionId` required inside `os.Logger`'s privacy-annotated interpolation**
- **Found during:** Task 1, first macbuild build attempt
- **Issue:** `xcodebuild build` failed: "reference to property 'editionId' in closure requires explicit use of 'self' to make capture semantics explicit." `os.Logger`'s privacy-annotated string interpolation wraps each interpolated value in an escaping autoclosure; the plan's drafted code (matching PATTERNS.md's example) referenced the instance property without `self.`, which the compiler rejects in this context.
- **Fix:** Added `self.` to the `editionId` reference; confirmed `** BUILD SUCCEEDED **` on macbuild.
- **Files modified:** `apps/ios/Rawkoon/ChapterDownloader.swift`
- **Verification:** `xcodebuild build` on macbuild at sha `f6067b0` → `** BUILD SUCCEEDED **`
- **Committed in:** `f6067b0`

**2. [Rule 1 - Bug] SwiftFormat's `redundantSelf` rule would strip the `self.` just added, reintroducing the build error**
- **Found during:** Task 2, `swiftformat --lint` verification
- **Issue:** `swiftformat Rawkoon Sources Tests --lint` reported `1/55 files require formatting`, flagging `ChapterDownloader.swift:194` for `redundantSelf` — it wanted to remove the `self.editionId` added in the fix above, which would silently reintroduce the original compiler error the next time someone ran `swiftformat` (not `--lint`) over the tree.
- **Fix:** Shadowed `editionId` into a local `let editionId = editionId` immediately before the log call, then referenced the local (unqualified) inside the interpolation. No `self.` needed anywhere; both the compiler and `redundantSelf` are satisfied.
- **Files modified:** `apps/ios/Rawkoon/ChapterDownloader.swift`
- **Verification:** `swiftformat Rawkoon Sources Tests --lint` on macbuild at sha `ec81010` → `0/55 files require formatting`; `xcodebuild build` → `** BUILD SUCCEEDED **`; `swiftlint lint` → `0 serious` in 55 files.
- **Committed in:** `ec81010`

**3. [Rule 1 - Bug] Plan's own `<verify>` command for the format gate used the wrong `swiftformat` argument order**
- **Found during:** Task 2, first `swiftformat --lint` invocation per the plan's literal `<automated>` command
- **Issue:** The plan's verify text runs `swiftformat --lint Rawkoon Sources Tests`, which fails immediately with `error: --lint argument does not expect a value.` — the same CLI parsing quirk 01-01's SUMMARY already documented and fixed (paths must precede `--lint`).
- **Fix:** Ran `swiftformat Rawkoon Sources Tests --lint` (paths first) instead, matching 01-01's already-verified, working invocation.
- **Files modified:** none (verification-command correction only; no plan text was edited)
- **Verification:** `swiftformat Rawkoon Sources Tests --lint` on macbuild → `0/55 files require formatting.` with exit 0.
- **Committed in:** n/a (execution-process fix, not a repo change)

---

**Total deviations:** 3 auto-fixed (all Rule 1 - bugs surfaced by macbuild's own build/format/lint tools, not by inspection). **Impact on plan:** All three were mechanical, discovered by literally re-running the plan's own `<verify>` commands as required by the HARD GATE, and fixed within the same task before proceeding. No acceptance criterion was weakened; two of the three (self-reference, redundantSelf) directly protect LOG-01/LOG-03's own build-green requirement, and the third is a verification-command typo, not a code defect.

## Issues Encountered

- **The `<human-check>` in Task 1's `<verify>` was not performed** — see "Human-check deferred" above for the full reasoning and the exact commands left for the user to run. This is the one plan-authored verification step this executor did not complete; every automated check passed.
- **A concurrent, unrelated commit landed on `main` mid-session.** Between this plan's initial read and its first push, the user's own session committed `e2f220d` ("ci(ios): gate TestFlight uploads on published releases only") directly to `main`. This is good news operationally: it means the four `git push origin main` calls this plan required (for macbuild's `git fetch` to see the new commits) did **not** trigger a real TestFlight upload as the prior-wave context warned — `testflight` is now gated on `github.event_name == 'release'`, not on a push to `main`. Each of this plan's four pushes ran `kit`+`lint`+`build` on GitHub Actions only. This commit was left completely untouched by this plan (not staged, not amended, not reviewed further) since it is out of this plan's scope.
- **One local process mistake, corrected before any harm.** The first fix-up commit (`self.editionId`) was initially applied via `git commit --amend` on top of an already-pushed commit — a violation of the "never amend pushed history" rule. This was caught immediately: the amend was undone with `git reset --soft` back to the pushed commit, and the fix was re-applied as a proper new commit (`f6067b0`) instead. No force-push occurred; origin's history for this plan is entirely append-only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `Logging.swift` and its five categories are in place; plan 01-03 can add the remaining six `try?`-site log calls (in `FileStore.swift`, `AudiobookPlayer.swift`, `AppModel.swift`) using the same `Log.<category>.error(...)` call shape and the local-shadow pattern documented above for any instance property.
- Both credential-locking scan commands are recorded verbatim above — 01-03 should re-run them, not re-derive them, once its own six call sites exist.
- **Before 01-03 (or phase sign-off) proceeds, the deferred `simctl launch` human-check above should be run once** — either standalone for this plan, or folded into the phase's end-of-phase human verification pass, consistent with `workflow.human_verify_mode: end-of-phase`.
- No blockers to 01-03 starting. `project.yml` is unchanged; the lint job from 01-01 will check 01-03's new files automatically on the next push.

---
*Phase: 01-lint-format-and-logging-guardrails*
*Completed: 2026-09-01*

## Self-Check: PASSED

All claimed files found on disk (`apps/ios/Rawkoon/Logging.swift`, `apps/ios/Rawkoon/ChapterDownloader.swift`, this SUMMARY). All claimed commits found in git history (`0258446`, `f6067b0`, `92d0579`, `ec81010`). All plan-level acceptance-criteria grep commands re-run and confirmed passing at HEAD (`ec81010`) immediately before writing this SUMMARY.
