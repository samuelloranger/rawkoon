---
phase: "1"
slug: "lint-format-and-logging-guardrails"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-01"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `01-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `swift test` (Swift Testing / XCTest via SwiftPM) — **`RawkoonKit` only** |
| **Config file** | `apps/ios/Package.swift` |
| **Quick run command** | `cd apps/ios && swift test` |
| **Full suite command** | Same — there is no app-target test bundle yet (that arrives in Phase 5, TEST-01/TEST-02) |
| **Estimated runtime** | ~30 seconds (Linux-safe) |

**Load-bearing caveat:** this phase's changes land entirely in the **app target**, which `swift test` cannot reach. `swift test` is a baseline regression guard here, not proof of this phase's work. The real gate is `macbuild` (`xcodegen generate` + `xcodebuild build`) plus the manual verification below — consistent with the milestone constraint that no phase is done on a green Linux run.

---

## Sampling Rate

- **After every task commit:** `cd apps/ios && swift test`
- **After every plan wave:** full `macbuild` sequence — `swift test` + `xcodegen generate` + `xcodebuild build`, plus the lint/logging manual checks below
- **Before `/gsd-verify-work`:** Linux `kit` job green, `macbuild` `xcodebuild build` green at the verified HEAD sha, TestFlight upload succeeds, no user-visible change
- **Max feedback latency:** ~30s local (`swift test`), ~10min for a `macbuild` round trip

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| LINT-01 | `lint` job exists in `ios.yml`, ordered before `build` | CI run | `gh run list --workflow ios.yml` → `lint` green on `main` | ❌ W0 | ⬜ pending |
| LINT-02 | `.swiftlint.yml` size rules `warning:`-only, `file_length` in [1443,1600] | lint run | `swiftlint lint --config apps/ios/.swiftlint.yml apps/ios/Rawkoon` → zero `error:` lines | ❌ W0 | ⬜ pending |
| LINT-03 | `swiftformat --lint` clean | lint run | `swiftformat --lint apps/ios` → exit 0 | ❌ W0 | ⬜ pending |
| LINT-04 | Every `disabled_rules` entry carries a reason | source assertion | read `.swiftlint.yml` top to bottom — no bare list | ❌ W0 | ⬜ pending |
| LOG-01 | 5 `Logger` categories exist | source assertion | `grep -c 'Logger(subsystem:' apps/ios/Rawkoon/Logging.swift` → 5 | ❌ W0 | ⬜ pending |
| LOG-02 | In-scope `try?` sites logged or commented | source inspection | `grep -rn 'try?' AudiobookPlayer.swift ChapterDownloader.swift FileStore.swift` — each hit logged or commented | N/A | ⬜ pending |
| LOG-03 | No credential/token/grant-URL interpolation in the diff | source inspection | review diff for `ManifestChapter.url`, bearer, password interpolation | N/A | ⬜ pending |
| LOG-04 | Log-retrieval docs page exists | file assertion | `test -f apps/ios/docs/<logging-page>.md` + contains `log collect --device-udid` and `simctl spawn booted log` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/ios/.swiftlint.yml` — does not exist, created this phase
- [ ] `apps/ios/.swiftformat` — does not exist, created this phase
- [ ] `apps/ios/Rawkoon/Logging.swift` (or equivalent) — does not exist, created this phase
- [ ] **Measurement run on `macbuild`**: SwiftLint with deliberately generous size-rule thresholds, to read the real `type_body_length` / `function_body_length` worst-cases before locking final values. A genuine Wave-0 prerequisite (Research Open Question 2) — the thresholds are deliberately NOT guessed.
- [ ] No app-target unit-test framework exists yet (Phase 5). LOG-02/03/04 are verified manually / on-device **by design**, not by a test this phase can write.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 404 chapter download logs book/chapter id + status code **readable, not `<private>`** | LOG-03 | Requires a booted simulator and a forced network failure; no app-target test harness until Phase 5 | On `macbuild`: `simctl launch` the app (**not** Xcode Run — `OS_ACTIVITY_DT_MODE` disables privacy redaction under Xcode, so an Xcode run proves nothing), force a chapter download against a 404 URL, and `xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"'` |
| No credential leak in any log line | LOG-03 | Diff review; `ManifestChapter.url` is a server-signed time-limited grant URL per `ChapterDownloader.swift`'s own comments | Read the full diff; assert no interpolation of bearer tokens, passwords, or `ManifestChapter.url` |
| Playback parity with v1.12.6 (play / pause / resume a downloaded chapter) | — (phase constraint) | The `try?` → `do/catch` conversion in the playback path is this phase's behavior risk | Install the phase's TestFlight build; play, pause, resume a downloaded chapter |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s locally
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
