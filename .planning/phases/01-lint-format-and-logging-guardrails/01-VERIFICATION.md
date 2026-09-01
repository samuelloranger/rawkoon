---
phase: 01-lint-format-and-logging-guardrails
verified: 2026-09-01T22:12:03Z
status: passed
score: 5/5 must-haves verified (2 with a deferred live/behavioral component)
behavior_unverified: 2
overrides_applied: 2
re_verification:
  previous_status: human_needed
  previous_score: 5/5 must-haves verified (2 with a deferred live/behavioral component)
  gaps_closed: []
  gaps_remaining:
    - "Success Criterion 4, live half — a genuine forced 404 has now been attempted on macbuild's simulator and still did not produce a Log.download.error line, but the failure mode (all 189 download tasks in the run failed identically with NSURLErrorUnknown(-1) as BackgroundDownloadTask, including chapters that would 200, while curl gets 200/identical bytes for the same URLs from both macbuild and inside the simulator) points to a background-URLSession-in-Simulator limitation rather than a defect in the logging code itself. Neither proven nor disproven — needs a real device, not another simulator run."
    - "Success Criterion 5, live half — device play/pause/resume parity was attempted and the tester could not complete a clean parity check because chapter selection kept landing on the wrong chapter (see out-of-scope finding below); the underlying parity question (does this phase's try?-to-do/catch conversion change playback behavior) is still not directly observed, only inferred from a line-by-line diff."
  regressions: []
gaps: []
deferred: []
out_of_scope_findings:
  - finding: "Tapping a chapter (or landing on one via AVQueuePlayer's failure recovery) sometimes starts a different chapter, and 'previous chapter' can move forward instead of back."
    board_id: "#962"
    disposition: "Confirmed PRE-EXISTING, not a phase-1 regression. `git diff -w --ignore-blank-lines v1.12.6..v1.12.7 -- 'apps/ios/**/*.swift'` shows every AudiobookPlayer.swift change in the v1.12.7 release is formatting only (brace expansion on single-statement closures/guards, `_` for unused delegate parameters) plus two try?-to-do/catch conversions (audio-session deactivation, artwork fetch) that preserve control flow and condition order verbatim — the do/catch branches only add a Log.playback.error call on the existing failure path, they do not change what happens on success. `seekWhenReady`'s `case .failed: isSeeking = false` (no log, no error surfaced) and `buildQueue`'s `continue`-skip of a chapter with no playbackURL both existed unchanged since v1.12.6 (git blame traces the pattern back to the file's original `feat(ios): add audiobook app adapter layer`, 2026-08-30, before phase 1 started). Root cause fixed on main OUTSIDE this phase in commit 91f9061 (`fix(ios): recover from an unreadable downloaded chapter`) plus 6985b32 (`fix(ios): verify downloaded chapters by content, not just length`) — both already on HEAD (1189b11) and covered by a green CI run (33564336170: lint/kit/build all success). Per explicit user scope decision, this does not fail phase 1; it is out of phase 1's goal (lint/format/logging guardrails), even though it surfaced during this phase's UAT and was a real, user-blocking bug."
  - finding: "The non-2xx branch of `ChapterDownloader.urlSession(_:downloadTask:didFinishDownloadingTo:)` — the one place phase 1 added `Log.download.error` for a failed chapter download — never fired during a live forced-404 test; separately, `urlSession(_:task:didCompleteWithError:)`, which is the delegate method background URLSession actually invoked for all 189 download tasks in that test (status -1, NSURLErrorUnknown), has zero logging of any kind and calls `applyEventAndContinue(.transportFailed(...))` silently. That silent branch predates phase 1 (added 2026-08-30, in the same original ChapterDownloader.swift commit as the AudiobookPlayer issue above) and is not a `try?` site, so it falls outside LOG-02's literal text ('every try? ... reports its failure or carries a comment') and outside Success Criterion 3's grep-based check — but it is squarely inside Criterion 4's spirit ('the log is worth reading in the field' for a download failure)."
    board_id: "#963"
    disposition: "Genuinely unresolved, tracked, not treated as a phase-1 regression because the code phase 1 actually wrote (the Log.download.error call in the non-2xx status branch) is unchanged, present, correctly wired, and privacy-annotated — it simply was never reached in the only test performed, and the evidence (all 189 tasks failing identically regardless of the target URL's real status, against a host that curl reaches successfully with 200s) is stronger for 'background URLSession does not complete real transfers in this Simulator/Xcode combination at all' than for 'the code is broken.' Not closed: nobody has run this test on a physical device, and the pre-existing didCompleteWithError silent path means even a correctly-working non-2xx branch would miss transport-level failures (timeouts, DNS errors, and possibly some 404s depending on how the session resolves them) in the field. This is recorded as a real, open, but out-of-literal-scope gap for a future phase to close, not as phase 1 failing its own success criteria."
behavior_unverified_items:
  - truth: "The log is worth reading in the field: forcing a real chapter 404 and streaming the subsystem shows book/chapter identifier and status code readable, not <private> (Success Criterion 4, live half)"
    test: "On a REAL iPhone (not the Simulator — see out-of-scope finding #963 for why the Simulator cannot currently validate this), sign in to a real Rawkoon server, force a genuine HTTP 404 for one chapter, start the download, and stream `xcrun devicectl` or `log collect --device-udid` filtered on `subsystem == \"cloud.samlo.rawkoon\"`."
    expected: "The `download`-category log line shows editionId, fileId, and status as plain numbers, not the `<private>` placeholder — assuming `didFinishDownloadingTo` is in fact invoked for a completed-but-404 background download on a real device, which this phase has still not observed on any platform."
    why_human: "Requires live sign-in credentials, UI-driven interaction, and mutating a real running production library file to force the 404 — and, per the failed macbuild-simulator attempt, apparently requires a physical device, since background URLSession downloads did not complete at all in the simulator regardless of the target's real HTTP status. The static half (privacy: .public annotations present on all three values, confirmed by direct code read at current HEAD) is verified; the runtime rendering remains unexercised on any platform."
  - truth: "A downloaded chapter plays, pauses, and resumes on the TestFlight build exactly as v1.12.6 did (Success Criterion 5, live half)"
    test: "Install a TestFlight build with board #962 fixed on a real iPhone. Pick a chapter known not to trigger the pre-existing unreadable/mismatched-file recovery path. Play a downloaded chapter, pause, resume."
    expected: "Audio starts, pauses immediately with unchanged Lock Screen artwork/now-playing info, and resumes from the same position — no new error text, no changed wording or layout, identical to v1.12.6."
    why_human: "Requires a real iPhone with the TestFlight build installed and manual play/pause/resume interaction. The first attempt at this check could not be completed cleanly because it collided with the pre-existing (now-fixed-on-main, not-yet-flown) board #962 defect. This phase's own declared behavior risk — the try?-to-do/catch conversions in AudiobookPlayer.swift (session teardown, artwork fetch) — is confirmed line-for-line control-flow-equivalent by diff (see out-of-scope finding above), but that is static reasoning, not an observed pass/pause/resume cycle."
human_verification:
  - test: "On a real iPhone (not the Simulator), force a real chapter download 404 against a build with board #962/#963 context in mind, and confirm the log line renders plain values, not `<private>`, and that it fires at all for the delegate method actually invoked."
    expected: "editionId, fileId, and status render as plain numbers in device log output filtered on `subsystem == \"cloud.samlo.rawkoon\"`."
    why_human: "Needs live server credentials, a genuine 404, and a physical device — the Simulator was tried and could not complete any background download regardless of target URL, so it cannot currently distinguish 'code works' from 'code untested.'"
  - test: "On a real iPhone, install a TestFlight build with board #962 fixed, play a downloaded chapter (avoiding any chapter that would trigger the recovery path), pause, and resume."
    expected: "Behavior is indistinguishable from v1.12.6 — same audio start, same pause/resume behavior, same Lock Screen info, no new error text anywhere."
    why_human: "Requires physical device interaction; the first attempt was blocked by an unrelated pre-existing defect (board #962) before it could reach the actual play/pause/resume check this phase cares about."
---

## Overrides — accepted unverified, by user decision (2026-09-01)

The verifier's own verdict on this report was `human_needed`, and its reasoning
stands unaltered below. The phase is marked `passed` by an explicit decision of
the user to accept it, NOT because the two live checks were performed. They were
not. This section exists so acceptance is never later mistaken for evidence.

**Override 1 — Criterion 4, live half (forced-404 log redaction).**
Proven: the `privacy: .public` annotations are present and correct, both
credential scans return zero, and a `Log.playback` line emitted via `simctl` with
no debugger attached printed `from=20289.000000 to=4373.290000` as plain numbers
rather than `<private>`, exercising the same annotation mechanism through a
different call site.
Not proven: that a download failure produces a readable line in the field. The
verifier is right that the evidence does not settle Simulator-artifact vs
code-gap, and an earlier framing of this as "very likely environmental" overstated
it. Tracked as board #963.

**Override 2 — Criterion 5, live half (device playback parity).**
Never run on a device. The defect UAT surfaced here is pre-existing, traced by
the verifier via `git blame` to `897e8b9` (2026-08-30), before this phase began;
it was fixed on `main` outside the phase and is tracked as board #962. The
phase's own conversions are confirmed control-flow-equivalent by diff, which is
static reasoning, not an observed play/pause/resume cycle.

**Carried forward, and the most useful thing this re-verification found:**
`urlSession(_:task:didCompleteWithError:)` has NO logging of any kind and calls
`applyEventAndContinue(.transportFailed(...))` silently. It is not a `try?` site,
so it sits outside LOG-02's literal text and outside Criterion 3's grep — but it
is squarely inside Criterion 4's intent. Every one of the 189 download tasks in
the live test went down that silent path. A future phase should close it;
accepting phase 1 does not close it.

# Phase 1: Lint, format, and logging guardrails Verification Report

**Phase Goal:** The repo holds the code's boundaries instead of review doing it — a CI job rejects style and size regressions, and when a download or a chapter fails there is a log line saying so.
**Verified:** 2026-09-01T22:12:03Z
**Status:** human_needed
**Re-verification:** Yes — after UAT (`01-UAT.md`) ran the two live checks the initial verification had deferred to human verification.

## What changed since the initial verification

Two things happened between the initial `passed`-on-statics / `human_needed`-on-live-checks verification and this pass:

1. **UAT ran both deferred live checks** (`01-UAT.md`) and recorded an issue on each.
2. **`main` moved on** (commits `91f9061`, `6985b32`, `f04a937`, `d99cf64`) to fix the root cause UAT's test 2 surfaced — an unrelated, pre-existing defect, not a phase-1 regression. This touched `AudiobookPlayer.swift`, `ChapterDownloader.swift`, and `AppModel.swift`, three of phase 1's own deliverable files, so this re-verification re-checked phase 1's own artifacts against current HEAD (`1189b11`), not just against the state at initial verification.

## Goal Achievement

### Observable Truths (mapped to ROADMAP.md Success Criteria 1-5)

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | A `lint` job exists in `.github/workflows/ios.yml`, runs `swiftformat --lint` and `swiftlint lint` over `Rawkoon`, `Sources`, `Tests`; `build` gains `needs:` on it; passes green on a real Actions run | ✓ VERIFIED | Re-read `.github/workflows/ios.yml` at current HEAD: unchanged — `lint` job runs `swiftformat Rawkoon Sources Tests --lint` then `swiftlint lint`; `build: needs: [kit, lint]`. Re-checked the latest real Actions run at current HEAD (`1189b11`, run `33564336170`, which includes all four out-of-scope fix commits): `lint`=success, `kit`=success, `build`=success. Regression-free. |
| 2 | `.swiftlint.yml` sets size rules `warning:`-only, `file_length` in [1443,1600], zero `error:`-severity, every `disabled_rules` entry reasoned | ✓ VERIFIED | Re-read `apps/ios/.swiftlint.yml` at current HEAD: unchanged from initial verification. `file_length: warning: 1500`, no `error:` key, both `disabled_rules` entries reasoned. |
| 3 | `Logger(subsystem: "cloud.samlo.rawkoon", category:)` exists with 5 categories; no `try?` in `AudiobookPlayer.swift` or the download path is both unlogged and uncommented | ✓ VERIFIED | Re-read `Logging.swift` (unchanged, 5 categories). Re-ran `grep -n "try?"` across `AudiobookPlayer.swift` (0, unchanged), `ChapterDownloader.swift` (3, each still carries a reason comment — confirmed by direct read of lines 227-229, 259-269), `FileStore.swift` (3, each still carries a reason comment — confirmed by direct read of lines 18-34), `AppModel.swift` (`refreshGrants` still `do`/`catch` + `Log.download.error`, confirmed at line 505-514; the ~17 other untouched `try?` sites are unchanged sign-in/notification/reading-progress-sync concerns). The out-of-scope fix commits added two *new* `Log.playback.error` sites in `AudiobookPlayer.swift` (`logItemFailure`, `recoverFromFailedLocalItem`, lines 837 and 876) that follow this phase's exact logging convention (privacy-annotated interpolation) — a good sign the pattern this phase established is being followed, though those two sites are not this phase's own deliverable. |
| 4 | The log is worth reading in the field: forcing a real 404 and streaming the subsystem shows book/chapter id and status readable, not `<private>`; no line in the diff interpolates a credential | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (static half ✓ VERIFIED, live half attempted and inconclusive) | Static half re-verified at current HEAD: all `Log.*.error` call sites (11 total now, including the two new ones from the out-of-scope fix) still explicitly `privacy: .public` on every interpolated value, never a bare `error`. Re-ran both credential scans fresh against current HEAD: `grep -rn -A3 'Log\.[a-z]*\.' apps/ios/Rawkoon \| grep -ciE 'bearer\|password\|authorization\|chapter\.url\|\\\(error[,)]'` → `0`; bare-error-interpolation scan → `0`. **Live half: UAT ran this exact test on macbuild's simulator with a genuine forced 404 (see `01-UAT.md` test 1) and got zero log lines** — not a redaction problem, an emission problem: `nsurlsessiond` requested the 404'd URL 12 times and the delegate branch carrying `Log.download.error` never ran. Root-cause diagnosis (from the session that produced the "what UAT established" record, corroborated by board #963's title) is that this is very likely a Simulator-specific background-URLSession failure, not a code defect: all 189 download tasks in the run — not just the one deliberately 404'd — failed identically with `NSURLErrorUnknown(-1)`, routed through `urlSession(_:task:didCompleteWithError:)` rather than `didFinishDownloadingTo`, while the same URLs return 200 with byte-identical content to `curl` from both macbuild and inside the simulator. That is stronger evidence of an environment limitation than of a logging defect, but it is not proof either way — nobody has run this test on a physical device, where a completed-but-404 background download should reach `didFinishDownloadingTo`. **This truth is NOT proven true. It is also not proven false as a phase-1 defect** — it stays unverified, and is now compounded by a second, independently confirmed, but pre-existing and out-of-literal-scope finding: the silent `didCompleteWithError` → `.transportFailed` path has no logging at all (see out-of-scope finding, board #963), so even a correctly-working `didFinishDownloadingTo` branch would miss transport-level download failures in the field. |
| 5 | `apps/ios/docs/` has device/simulator log-pull commands; TestFlight build plays/pauses/resumes a downloaded chapter exactly as v1.12.6 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (docs half ✓ VERIFIED, live half attempted, blocked by an unrelated pre-existing defect) | Docs half re-verified: `apps/ios/docs/log-retrieval.md` unchanged, still has both simulator forms, device retrieval, and the `OS_ACTIVITY_DT_MODE` caution. **Live half: UAT attempted this (test 2) and reported an issue** — the tester could not reliably select and play a downloaded chapter because tapping a chapter sometimes landed on a different one (~chapter 23) and "previous chapter" sometimes moved forward. **This is confirmed PRE-EXISTING, not a phase-1 regression** — see the git-diff evidence in "What changed since the initial verification" and the out-of-scope finding above. Because the tester never got a clean shot at "play, pause, resume" without hitting the pre-existing chapter-selection bug, the specific parity question this criterion asks about (does this phase's try?-to-do/catch conversion change play/pause/resume behavior) is still not directly observed — only inferred from the line-for-line diff equivalence. |

**Score:** 5/5 truths present, wired, and statically verified at current HEAD (re-confirmed after the out-of-scope fixes landed); 2 of those 5 (criteria 4 and 5) still carry a live/behavioral component that has now been *attempted* but not successfully exercised — one blocked by an apparent Simulator limitation, one blocked by an unrelated pre-existing bug. Neither attempt produced evidence that phase 1's own code is broken; neither attempt produced evidence that it works, either.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `apps/ios/.swiftlint.yml` | Warning-only size rules, reasoned `disabled_rules` | ✓ VERIFIED | Re-read at current HEAD; unchanged. |
| `apps/ios/.swiftformat` | Default rule set minus two reasoned exceptions | ✓ VERIFIED | Unchanged since initial verification (not touched by out-of-scope commits). |
| `.github/workflows/ios.yml` | New `lint` job; `build` gated on it | ✓ VERIFIED | Re-read at current HEAD; unchanged. |
| `apps/ios/Rawkoon/Logging.swift` | 5-category `Log` namespace | ✓ VERIFIED | Re-read; unchanged. |
| `apps/ios/docs/log-retrieval.md` | Device/simulator retrieval commands + redaction caution | ✓ VERIFIED | Re-read; unchanged. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `ChapterDownloader.swift` non-2xx branch | `Logging.swift` | `Log.download.error(...)` call | ✓ WIRED (present half); ⚠️ never observed firing live | Re-read at current HEAD, line 201 — call site unchanged, still the first statement in the non-2xx branch. |
| `FileStore.swift` `deleteEdition`/`createDirectoryIfNeeded` | `Logging.swift` | `Log.download.error(...)` calls | ✓ WIRED | Re-verified at lines 43 and 83 (line numbers shifted slightly from initial verification due to unrelated file growth; call sites intact). |
| `AppModel.swift` `refreshGrants` catch | `Logging.swift` | `Log.download.error(...)` call | ✓ WIRED | Re-verified at line 509 (shifted from 491 due to the out-of-scope fix's unrelated additions elsewhere in the file; content unchanged). |
| `AudiobookPlayer.swift` session teardown + artwork fetch | `Logging.swift` | `Log.playback.error(...)` calls | ✓ WIRED | Re-verified at lines 332 and 877 (shifted; content unchanged). Two *new* sites added by the out-of-scope fix (837, 976) follow the same pattern but are not this phase's deliverable. |
| `.github/workflows/ios.yml` `build` job | `lint` job | `needs: [kit, lint]` | ✓ WIRED | Unchanged. |
| `log-retrieval.md` | `Logging.swift` | every command filters `subsystem == "cloud.samlo.rawkoon"` | ✓ WIRED | Unchanged. |
| `ChapterDownloader.swift` `didCompleteWithError` | `Logging.swift` | *(no link exists)* | ✗ NOT WIRED (out-of-scope, pre-existing) | Confirmed by direct read, lines ~271-276: `guard let error else { return }` → `guard nsError.code != NSURLErrorCancelled else { return }` → `applyEventAndContinue(.transportFailed(...))`, no `Log.*` call anywhere in the method. Predates phase 1 (added 2026-08-30). This is the delegate method that actually fired during UAT's test 1. Tracked as board #963; not a phase-1-introduced gap and not a `try?` site, so not a literal LOG-02/Criterion-3 failure, but directly relevant to Criterion 4's live-verification failure. |

### Behavioral Spot-Checks (via real CI run logs, not SUMMARY claims)

| Behavior | Command | Result | Status |
|---|---|---|---|
| `swiftformat --lint` / `swiftlint lint` / `swift test` clean on real CI at initial-verification HEAD | `gh run view` on runs `33544854087` and `33549776606` | Unchanged from initial verification | ✓ PASS |
| CI still green at current HEAD, after the out-of-scope fix commits touched three of this phase's own deliverable files | `gh run view 33564336170 --json jobs` | `lint`=success, `kit`=success, `build`=success (`testflight` skipped — not a release push) | ✓ PASS |
| Credential scan over all log call sites at current HEAD | `grep -rn -A3 'Log\.[a-z]*\.' apps/ios/Rawkoon \| grep -ciE '...'` (run fresh, this session) | `0` | ✓ PASS |
| Bare-error-interpolation scan at current HEAD | `grep -rEc '\\\(error[,)]' apps/ios/Rawkoon --include='*.swift' \| grep -v ':0$' \| wc -l` (run fresh, this session) | `0` | ✓ PASS |
| Forced-404 log emission (UAT test 1) | `xcrun simctl launch` + real server 404 + `log show` filtered on subsystem, per `01-UAT.md` | Zero log lines; download tasks failed transport-level (-1), not HTTP-level (404), in the simulator | ✗ INCONCLUSIVE — did not exercise the code path under test |
| Device play/pause/resume parity (UAT test 2) | Manual TestFlight v1.12.7 test, per `01-UAT.md` | Blocked by pre-existing chapter-selection bug (board #962) before reaching a clean play/pause/resume cycle | ✗ INCONCLUSIVE — did not exercise the behavior under test |
| v1.12.6→v1.12.7 diff review (this session, to adjudicate UAT test 2) | `git diff -w --ignore-blank-lines v1.12.6..v1.12.7 -- 'apps/ios/**/*.swift'` | Every `AudiobookPlayer.swift` change is formatting or a control-flow-preserving try?→do/catch conversion; `seekWhenReady`/`buildQueue`'s failure-swallowing behavior is byte-identical to v1.12.6 | ✓ PASS — confirms test 2's defect is pre-existing |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| LINT-01 | 01-01 | `.swiftlint.yml`/SwiftFormat config committed, both run clean | ✓ SATISFIED | Re-confirmed at current HEAD; CI green. |
| LINT-02 | 01-01 | Size rules enabled as warnings, thresholds above current worst offenders | ✓ SATISFIED | Unchanged. |
| LINT-03 | 01-01 | `lint` job fails build on violation, runs before macOS jobs | ✓ SATISFIED | Unchanged. |
| LINT-04 | 01-01 | Every disabled rule commented, no blanket dump | ✓ SATISFIED | Unchanged. |
| LOG-01 | 01-02 | Single logging surface, one category per domain | ✓ SATISFIED | Unchanged. |
| LOG-02 | 01-02, 01-03 | Every `try?` in download/playback path logged or reason-commented | ✓ SATISFIED (with documented scope) | All 9 in-scope `try?` sites re-confirmed disposed at current HEAD. Note: `didCompleteWithError`'s silent `.transportFailed` path is NOT a `try?` site and is outside this requirement's literal text — recorded as an out-of-scope finding (board #963), not a LOG-02 failure. |
| LOG-03 | 01-02 | No logged value leaks a credential; explicit privacy annotations where public | ✓ SATISFIED | Both credential scans re-run fresh at current HEAD, both `0`. Live redaction-rendering under a real 404 remains unproven (see Criterion 4). |
| LOG-04 | 01-03 | `docs/` records device/simulator log retrieval | ✓ SATISFIED | Unchanged. |

No orphaned requirements — all 8 (`LINT-01..04`, `LOG-01..04`) map to Phase 1 in `.planning/REQUIREMENTS.md` (lines 111-118) and each appears in a plan's `requirements:` frontmatter.

### Anti-Patterns Found

None in phase 1's own deliverable files, re-scanned at current HEAD. The out-of-scope fix commits (`91f9061`, `6985b32`, `f04a937`, `d99cf64`) that touched `AudiobookPlayer.swift`, `ChapterDownloader.swift`, and `AppModel.swift` were also scanned for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` — none found; they are outside this phase's scope regardless.

### Human Verification Required

### 1. Live redaction check under a forced 404, on a real device (Success Criterion 4)

**Test:** Sign in to a real Rawkoon server on a physical iPhone, force a genuine HTTP 404 for one chapter, start the download, and pull device logs filtered on `subsystem == "cloud.samlo.rawkoon"`.
**Expected:** The `download`-category log line shows `editionId`, `fileId`, and `status` as plain numbers, not `<private>` — and fires at all, through whichever delegate method a real device actually invokes for a completed 404 response.
**Why human:** The Simulator attempt (`01-UAT.md` test 1) could not distinguish "the code doesn't log this" from "the Simulator can't complete this background transfer at all" — all 189 download tasks in that run failed identically regardless of target URL. Only a physical device can settle this. If it still doesn't fire on-device, board #963's `didCompleteWithError` gap is the prime suspect.

### 2. Device play/pause/resume parity, avoiding the now-fixed pre-existing bug (Success Criterion 5)

**Test:** Install a TestFlight build that includes the board #962 fix, pick a chapter that is known to be playable (not one that would trigger the corrupt-file recovery path), and play/pause/resume it.
**Expected:** Audio starts, pauses immediately with unchanged Lock Screen artwork/now-playing info, and resumes from the same position — no new error text, no changed wording or layout, identical to v1.12.6.
**Why human:** Requires a physical device and manual interaction. The first attempt never reached this check because it collided with an unrelated, now-fixed, pre-existing defect. The line-for-line diff review in this report is strong static evidence the try?→do/catch conversions are behavior-preserving, but it is not a substitute for observing the actual cycle.

### Gaps Summary

No phase-1-caused gaps. Both UAT-reported issues were investigated and neither traces to code phase 1 wrote or changed:

- **Test 2's defect (chapter-selection/AVPlayerItem-failure)** is confirmed pre-existing by a `git diff -w --ignore-blank-lines v1.12.6..v1.12.7` review showing every `AudiobookPlayer.swift` change in the release is formatting plus two control-flow-preserving `try?`→`do`/`catch` conversions. Root cause (`FileStore` trusting file size alone) is already fixed on `main` outside this phase. Per explicit user direction, this is out of phase 1's scope and does not fail the phase. Recorded above with board id **#962**.
- **Test 1's defect (no log line on a forced 404)** could not be confirmed as a phase-1 code defect: the delegate method that actually fired (`didCompleteWithError`, status -1 on all 189 tasks including ones that would 200) is not the one phase 1 instrumented (`didFinishDownloadingTo`'s non-2xx branch, which is present, wired, and privacy-correct but never reached). The evidence favors a Simulator-specific background-URLSession limitation over a code defect, but this is not proven — no real-device test has been run. Separately, and regardless of the Simulator question, `didCompleteWithError`'s silent path is a genuine, pre-existing, out-of-literal-scope gap in download-failure observability. Recorded above with board id **#963**.

Because neither of Criteria 4 and 5's live halves has been successfully observed (only attempted), the phase's status remains **human_needed**, unchanged from the initial verification's disposition, though the substance behind it has changed: instead of "these checks were never attempted," it is now "these checks were attempted, on the only environment available to this session, and both attempts were confounded by causes outside phase 1's own code." A real-device pass at both checks (ideally after board #962 is shipped and #963 is triaged) is what would move this phase to `passed`.

---

_Verified: 2026-09-01T22:12:03Z_
_Verifier: Claude (gsd-verifier)_
