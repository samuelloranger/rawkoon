---
phase: 01-lint-format-and-logging-guardrails
verified: 2026-09-01T21:15:00Z
status: passed
score: 5/5 must-haves verified (2 with a deferred live/behavioral component)
behavior_unverified: 2
overrides_applied: 2
behavior_unverified_items:
  - truth: "The log is worth reading in the field: forcing a real chapter 404 and streaming the subsystem shows book/chapter identifier and status code readable, not <private> (Success Criterion 4, live half)"
    test: "On macbuild's booted simulator, start `xcrun simctl spawn booted log stream --predicate 'subsystem == \"cloud.samlo.rawkoon\"'`, then `xcrun simctl launch booted cloud.samlo.rawkoon` (never Xcode's Run/Debug button — OS_ACTIVITY_DT_MODE disables redaction and would produce a false pass). Sign in to a real Rawkoon server, force a genuine HTTP 404 for one chapter (rename its file on the server), start the download."
    expected: "The `download`-category log line shows editionId, fileId and status as plain numbers, not the `<private>` placeholder."
    why_human: "Requires live sign-in credentials, UI-driven interaction (no XCUITest harness in scope), and mutating a real running production library file to force the 404 — none of which the executor or this verifier can do from an automated session. The static half (privacy: .public annotations present on all three values, confirmed by direct code read) is verified; only the runtime rendering is unexercised."
  - truth: "A downloaded chapter plays, pauses, and resumes on the TestFlight build exactly as v1.12.6 did (Success Criterion 5, live half)"
    test: "Install the v1.12.7 TestFlight build on a real iPhone. Open a book with chapters already downloaded. Play a downloaded chapter, pause, resume."
    expected: "Audio starts, pauses immediately with unchanged Lock Screen artwork/now-playing info, and resumes from the same position — no new error text, no changed wording or layout, identical to v1.12.6."
    why_human: "Requires a real iPhone with the TestFlight build installed and manual play/pause/resume interaction. This phase's playback-path try?-to-do/catch conversion in AudiobookPlayer.swift (session teardown, artwork fetch) is the phase's own declared behavior risk; the SUMMARY's prose state-transition review is strong static evidence of equivalence but does not substitute for hearing/feeling the actual behavior."
human_verification:
  - test: "Force a real chapter download 404 against the v1.12.7 (or later) build on macbuild's simulator via `simctl launch` (not Xcode's debugger) and confirm the log line renders plain values, not `<private>`."
    expected: "editionId, fileId, and status render as plain numbers in `log stream` output filtered on `subsystem == \"cloud.samlo.rawkoon\"`."
    why_human: "Needs live server credentials and a genuine 404, which cannot be fabricated safely from this session; OS_ACTIVITY_DT_MODE under a debugger would produce a false pass."
  - test: "On a real iPhone, install the v1.12.7 TestFlight build, play a downloaded chapter, pause, and resume."
    expected: "Behavior is indistinguishable from v1.12.6 — same audio start, same pause/resume behavior, same Lock Screen info, no new error text anywhere."
    why_human: "Requires physical device interaction; this phase's one named behavior risk (playback try?→do/catch conversion) needs to be felt, not just read."
---

## Overrides — accepted unverified, by user decision (2026-09-01)

The phase is marked `passed` by an explicit decision of the user, NOT because the
two live checks below were performed. They were not. Both remain unexercised, and
this section exists so nobody later mistakes acceptance for evidence.

### 1. Criterion 4, live half — forced-404 log redaction

**Proven:** the `privacy: .public` annotations are present on all three values,
and both credential scans return zero. Independently, a `Log.playback` line
emitted through `simctl` with no debugger attached printed
`from=20289.000000 to=4373.290000` — plain numbers, not `<private>` — which
exercises the same annotation mechanism through a different call site.

**Not proven:** that a real chapter-download 404 produces its line in the field.
A forced 404 was staged against production and the chapter was requested 12
times, yet no line appeared. The cause is very likely environmental rather than a
product defect: an UNCONDITIONAL probe at the top of `didFinishDownloadingTo`
never fired either, no chapter file ever reached disk, and all 189 download tasks
in a run failed with `NSURLErrorUnknown (-1)` as `BackgroundDownloadTask`, while
the same URLs returned 200 and byte-identical content to `curl` from both the
build host and inside the simulator. Background transfers do not complete in this
simulator at all, so the branch cannot be reached there.

Tracked as board #963. Closing it needs a physical device or the app-target test
bundle that phase 5 introduces.

### 2. Criterion 5, live half — device playback parity

Never performed on a device. Note that the defect UAT surfaced here was
**pre-existing and not introduced by this phase**: `git diff -w
--ignore-blank-lines v1.12.6..v1.12.7 -- 'apps/ios/**/*.swift'` is formatting
only, and nothing in the release touches seeking, the queue, or chapter
selection. Root cause (a downloaded chapter trusted on size alone, failing to
open, with the failure swallowed) was found and fixed on `main` OUTSIDE this
phase, and is tracked as board #962. The user scoped it out of phase 1 on that
basis.

The phase's own conversions in `AudiobookPlayer.swift` — audio-session teardown
and artwork fetch — remain reviewed statically and unexercised on a device.


# Phase 1: Lint, format, and logging guardrails Verification Report

**Phase Goal:** The repo holds the code's boundaries instead of review doing it — a CI job rejects style and size regressions, and when a download or a chapter fails there is a log line saying so.
**Verified:** 2026-09-01T21:15:00Z
**Status:** passed (by explicit user override — see Overrides)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to ROADMAP.md Success Criteria 1-5)

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | A `lint` job exists in `.github/workflows/ios.yml`, runs `swiftformat --lint` and `swiftlint lint` over `Rawkoon`, `Sources`, `Tests`; `build` gains `needs:` on it; passes green on a real Actions run with no Swift source changed other than SwiftFormat's own output | ✓ VERIFIED | Read `.github/workflows/ios.yml` directly: `lint` job runs `swiftformat Rawkoon Sources Tests --lint` then `swiftlint lint` (both `working-directory: apps/ios`); `build: needs: [kit, lint]`. Confirmed the reformat-only run (commit `ec49445`, a `.swiftformat`/workflow-only diff sitting directly on top of the pure-reformat commit `b8f5ec8`) on real Actions run `33544854087` — `gh run view` shows `lint`=success, `kit`=success, `build`=success, `testflight`=success, headSha `ec49445`. |
| 2 | `.swiftlint.yml` sets `file_length`/`type_body_length`/`function_body_length` with `warning:` only, no `error:` key; `file_length` in [1443,1600]; zero `error:`-severity violations on a real run; every `disabled_rules` entry has a reason, no bare list | ✓ VERIFIED | Read `apps/ios/.swiftlint.yml` directly: `file_length: warning: 1500` (in range), `type_body_length: warning: 1400`, `function_body_length: warning: 100` — no `error:` key anywhere in the file (`grep -n "error:"` matches only prose comments explaining the *absence* of the key). `disabled_rules: [statement_position, todo]`, each preceded by a multi-line `#` comment explaining why. CI job log for release run `33549776606`'s `lint` job step "Run swiftlint lint" prints verbatim: `Done linting! Found 140 violations, 0 serious in 55 files.` (pulled directly from `gh run view --job --log`, not from a SUMMARY claim). |
| 3 | `Logger(subsystem: "cloud.samlo.rawkoon", category:)` exists with playback/download/network/auth/sync; no `try?` in `AudiobookPlayer.swift` or the download path is both unlogged and uncommented | ✓ VERIFIED | Read `apps/ios/Rawkoon/Logging.swift` directly: caseless `enum Log`, exactly 5 `static let` `Logger(subsystem: "cloud.samlo.rawkoon", category:)` properties named playback/download/network/auth/sync. Read every `try?` site in `AudiobookPlayer.swift` (0 remain — both converted to `do`/`catch` + `Log.playback.error`), `FileStore.swift` (3 remain, each with a distinct reason comment directly above it; 2 others converted to `Log.download.error`), `ChapterDownloader.swift` (1 remains, with a reason comment), `AppModel.swift`'s `refreshGrants` (0 `try?`, converted to `do`/`catch` + `Log.download.error`). Note on scope: `AppModel.swift` has ~17 other `try?` sites (SSO providers, push registration, reading-progress sync, position journal) untouched by this phase — these are read-through-verified to be sign-in/notification/reading-progress-sync concerns, not the audiobook-download path, and the phase's own `01-RESEARCH.md` documents this exact scoping decision (`Pitfall 3`) before execution. This is a defensible reading of the roadmap's ambiguous "the download path" phrase, not a shortcut discovered after the fact. |
| 4 | The log is worth reading in the field: forcing a real 404 and streaming the subsystem shows book/chapter id and status readable, not `<private>`; no line in the diff interpolates a bearer token, password, or credentialed URL | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (static half ✓ VERIFIED) | All 6 `Log.*.error` call sites read directly: every interpolated value explicitly annotated `privacy: .public`; every error logged via `.localizedDescription` (never a bare `error` value). Independently re-ran (not copied from SUMMARY) both credential scans against current HEAD: `grep -rn -A3 'Log\.[a-z]*\.' apps/ios/Rawkoon \| grep -ciE 'bearer\|password\|authorization\|chapter\.url\|\\\(error[,)]'` → `0`; `grep -rEc '\\\(error[,)]' apps/ios/Rawkoon --include='*.swift' \| grep -v ':0$' \| wc -l` → `0`. The live half (does a genuine 404 actually render plain, not redacted, under `simctl launch`) was never performed by any executor — see behavior_unverified_items. |
| 5 | `apps/ios/docs/` has a page with exact device/simulator log-pull commands; TestFlight build plays/pauses/resumes a downloaded chapter exactly as v1.12.6 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (docs half ✓ VERIFIED) | Read `apps/ios/docs/log-retrieval.md` directly: both simulator forms (`log stream`/`log show`), on-device `log collect --device-udid`, sysdiagnose/no-Mac routes, and the `OS_ACTIVITY_DT_MODE` debugger-redaction caution written as a standing warning (not just a testing note). The device play/pause/resume parity check against the real v1.12.7 TestFlight build was never performed — see behavior_unverified_items. |

**Score:** 5/5 truths present, wired, and statically verified; 2 of those 5 (criteria 4 and 5) carry a live/behavioral component that no test or human exercised — routed to human verification, not counted as fully proven.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `apps/ios/.swiftlint.yml` | Warning-only size rules, reasoned `disabled_rules` | ✓ VERIFIED | Read in full; matches expectations exactly. |
| `apps/ios/.swiftformat` | Default rule set minus two reasoned exceptions | ✓ VERIFIED | Read in full; `redundantSwiftUIGroup`/`redundantViewBuilder` disabled, each with a reason. |
| `.github/workflows/ios.yml` | New `lint` job; `build` gated on it | ✓ VERIFIED | Read in full; `lint` job present, `build: needs: [kit, lint]`. |
| `apps/ios/Rawkoon/Logging.swift` | 5-category `Log` namespace | ✓ VERIFIED | Read in full; exact shape. |
| `apps/ios/docs/log-retrieval.md` | Device/simulator retrieval commands + redaction caution | ✓ VERIFIED | Read in full; matches expectations. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `ChapterDownloader.swift` non-2xx branch | `Logging.swift` | `Log.download.error(...)` call | ✓ WIRED | Verified by direct read, line 196. |
| `FileStore.swift` `deleteEdition`/`createDirectoryIfNeeded` | `Logging.swift` | `Log.download.error(...)` calls | ✓ WIRED | Verified by direct read, lines 43 and 83. |
| `AppModel.swift` `refreshGrants` catch | `Logging.swift` | `Log.download.error(...)` call | ✓ WIRED | Verified by direct read, line 491. |
| `AudiobookPlayer.swift` session teardown + artwork fetch | `Logging.swift` | `Log.playback.error(...)` calls | ✓ WIRED | Verified by direct read, lines 329 and 911. |
| `.github/workflows/ios.yml` `build` job | `lint` job | `needs: [kit, lint]` | ✓ WIRED | Verified by direct read. |
| `log-retrieval.md` | `Logging.swift` | every command filters `subsystem == "cloud.samlo.rawkoon"` | ✓ WIRED | Verified by direct read; string matches `Logging.swift`'s `subsystem` literal exactly. |

### Behavioral Spot-Checks (via real CI run logs, not SUMMARY claims)

| Behavior | Command | Result | Status |
|---|---|---|---|
| `swiftformat --lint` clean on real CI | `gh run view --job <lint-job-id> --log` (run 33544854087, sha `ec49445`) | log line: `0/54 files require formatting.` | ✓ PASS |
| `swiftlint lint` zero-serious on real CI | `gh run view --job 99996089367 --log` (run 33549776606, sha `e9dbb08`) | log line: `Done linting! Found 140 violations, 0 serious in 55 files.` | ✓ PASS |
| `swift test` green on real CI | `gh run view --job 99996089533 --log` (run 33549776606) | log line: `Executed 72 tests, with 0 failures (0 unexpected)` | ✓ PASS |
| `build` starts only after `lint`/`kit` succeed | `gh run view 33549776606 --json jobs` | `lint` completed 19:30:16Z, `kit` completed 19:30:09Z, `build` started 19:30:19Z | ✓ PASS |
| Credential scan over all log call sites | `grep -rn -A3 'Log\.[a-z]*\.' apps/ios/Rawkoon \| grep -ciE '...'` (run fresh, this session) | `0` | ✓ PASS |
| Bare-error-interpolation scan | `grep -rEc '\\\(error[,)]' apps/ios/Rawkoon --include='*.swift' \| grep -v ':0$' \| wc -l` (run fresh, this session) | `0` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| LINT-01 | 01-01 | `.swiftlint.yml`/SwiftFormat config committed, both run clean | ✓ SATISFIED | Both config files exist, real CI run green. |
| LINT-02 | 01-01 | Size rules enabled as warnings, thresholds above current worst offenders | ✓ SATISFIED | `file_length: warning: 1500` clears `MediaDetailView.swift`'s 1443 lines; `type_body_length`/`function_body_length` measured on macbuild, not guessed. |
| LINT-03 | 01-01 | `lint` job fails build on violation, runs before macOS jobs | ✓ SATISFIED | `build: needs: [kit, lint]`, `lint` runs on `ubuntu-latest`. |
| LINT-04 | 01-01 | Every disabled rule commented, no blanket dump | ✓ SATISFIED | Both `disabled_rules` entries and both `.swiftformat --disable` entries carry reasons. |
| LOG-01 | 01-02 | Single logging surface, one category per domain | ✓ SATISFIED | `Logging.swift` matches exactly. |
| LOG-02 | 01-02, 01-03 | Every `try?` in download/playback path logged or reason-commented | ✓ SATISFIED (with documented scope) | All 9 in-scope sites (`ChapterDownloader` 1, `FileStore` 5, `AppModel.refreshGrants` 1, `AudiobookPlayer` 2) disposed; scope of "the download path" explicitly researched and documented in `01-RESEARCH.md` before execution. |
| LOG-03 | 01-02 | No logged value leaks a credential; explicit privacy annotations where public | ✓ SATISFIED | Both credential scans re-run this session, both return 0; every interpolation explicitly `privacy: .public`. Live redaction-rendering check still open (see truth 4). |
| LOG-04 | 01-03 | `docs/` records device/simulator log retrieval | ✓ SATISFIED | `apps/ios/docs/log-retrieval.md` exists with the required content. |

No orphaned requirements — REQUIREMENTS.md lists exactly LINT-01..04 and LOG-01..04 under Phase 1, and every one appears in a plan's `requirements:` frontmatter (01-01: LINT-01..04; 01-02: LOG-01..03; 01-03: LOG-02, LOG-04).

### Anti-Patterns Found

None. Scanned every file this phase created or modified (`Logging.swift`, `ChapterDownloader.swift`, `FileStore.swift`, `AppModel.swift`, `AudiobookPlayer.swift`, `log-retrieval.md`, `.swiftlint.yml`, `.swiftformat`, `.github/workflows/ios.yml`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`. The only matches are two comments inside `.swiftlint.yml` explaining *why* the `todo` SwiftLint rule is disabled — not debt markers themselves. `apps/ios/project.yml` confirmed untouched throughout the phase (`git log` shows no commit touching it since before this phase started).

### Human Verification Required

### 1. Live redaction check under a forced 404 (Success Criterion 4)

**Test:** On macbuild's booted simulator, start `xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"'`, then launch the app with `xcrun simctl launch booted cloud.samlo.rawkoon` (not Xcode's Run/Debug button). Sign in to a real Rawkoon server, force a genuine HTTP 404 for one chapter (rename its file server-side), and start the download.
**Expected:** The `download`-category log line shows `editionId`, `fileId`, and `status` as plain numbers, not the `<private>` placeholder.
**Why human:** Needs live server credentials, real UI interaction (no automation harness in scope), and mutating a running production library file — none of which any executor performed. `OS_ACTIVITY_DT_MODE` under a debugger would produce a false-positive "readable" result, so this must specifically use `simctl launch`, not Xcode.

### 2. Device play/pause/resume parity (Success Criterion 5)

**Test:** Install the `v1.12.7` TestFlight build on a real iPhone. Open a book with chapters already downloaded. Play a downloaded chapter, pause it, resume it.
**Expected:** Audio starts, pauses immediately with unchanged Lock Screen artwork/now-playing info, resumes from the same position — indistinguishable from v1.12.6, no new error text anywhere.
**Why human:** Requires a physical device and manual interaction. This is the phase's own declared behavior risk (the `try?`→`do`/`catch` conversions in `AudiobookPlayer.swift`'s session teardown and artwork fetch); the SUMMARY's prose state-transition review is strong static reasoning but does not substitute for observing the actual behavior.

### Gaps Summary

No gaps. Every artifact, key link, and static/wiring truth is present and correctly implemented, verified directly against the codebase and real CI run logs rather than taken from SUMMARY claims. The phase intentionally deferred two live checks to end-of-phase human verification (consistent with this project's own `workflow.human_verify_mode: end-of-phase`, and documented as such in both 01-02's and 01-03's SUMMARYs rather than silently skipped or fabricated). Both deferred items are narrow and specific — a runtime redaction rendering check, and a device playback-parity check — and both have exact, ready-to-run steps recorded above.

Two out-of-band process events are noted for completeness but did not affect the verdict: release `v1.12.7` was cut mid-phase to satisfy the plan's shippability gate after CI's TestFlight trigger changed to release-only, and cutting it triggered an unplanned (but content-no-op — `git diff v1.12.6..v1.12.7 -- apps/api apps/web apps/shared` is empty) production redeploy. Follow-up governance commits (`30df052`, `60155d2`) already restrict future phases from cutting releases on their own.

---

_Verified: 2026-09-01T21:15:00Z_
_Verifier: Claude (gsd-verifier)_
