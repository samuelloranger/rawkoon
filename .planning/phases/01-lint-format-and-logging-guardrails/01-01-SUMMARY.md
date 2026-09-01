---
phase: 01-lint-format-and-logging-guardrails
plan: 01
subsystem: infra
tags: [swiftlint, swiftformat, github-actions, ci, ios]

# Dependency graph
requires: []
provides:
  - "apps/ios/.swiftlint.yml — warning-only size rules with macbuild-measured thresholds"
  - "apps/ios/.swiftformat — default rule set minus two SwiftUI view-identity rules"
  - "lint job in .github/workflows/ios.yml, gating build via needs: [kit, lint]"
  - "apps/ios formatted once by SwiftFormat 0.63.0 (44/54 files touched)"
affects: [01-02, 01-03, "VM-04 (file_length ratchet-down)"]

# Actuals (#2632)
actuals:
  tokens: 36962
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: [SwiftLint 0.65.1, SwiftFormat 0.63.0]
  patterns:
    - "Homebrew formulae installed unpinned in CI, matching build's brew install xcodegen convention"
    - "disabled_rules / --disable entries always carry a # reason comment directly above them (LINT-04)"

key-files:
  created:
    - apps/ios/.swiftlint.yml
    - apps/ios/.swiftformat
  modified:
    - .github/workflows/ios.yml
    - "44 Swift files under apps/ios/Rawkoon, apps/ios/Sources, apps/ios/Tests (SwiftFormat output only)"

key-decisions:
  - "file_length warning threshold set to 1500 (D-B), clearing the current worst offender (MediaDetailView.swift, 1443 lines) with a deliberately small 57-line buffer"
  - "type_body_length and function_body_length thresholds measured on macbuild rather than guessed (D-C): 1325 -> 1400, 76 -> 100"
  - "strict mode deliberately deferred this phase (D-A) — 136 pre-existing warnings across ~15 rules would fail day one under --strict"
  - "redundantSwiftUIGroup and redundantViewBuilder disabled in .swiftformat (D-G) — both change a SwiftUI view's static type, which this milestone's no-visible-change constraint forbids touching"
  - "lint job runs on ubuntu-latest (D-D), matching kit's tier — neither tool needs Xcode or SourceKit-based rules beyond the one explicitly disabled (D-E, statement_position)"

patterns-established:
  - "Two-file CI job convention: install step evaluates /home/linuxbrew/.linuxbrew/bin/brew shellenv before brew install, then appends brew's bin dir to $GITHUB_PATH — required because the ubuntu-latest image ships Homebrew unlinked"
  - "swiftformat's --lint flag must follow the path arguments (swiftformat <paths> --lint), not precede them — leading with --lint mis-parses the first path as the flag's value"

requirements-completed: [LINT-01, LINT-02, LINT-03, LINT-04]

coverage:
  - id: D1
    description: ".swiftlint.yml authored with macbuild-measured size thresholds, all warning-only, zero serious violations on the untouched tree"
    requirement: LINT-02
    verification:
      - kind: other
        ref: "ssh macbuild: swiftlint lint (apps/ios) -> 'Done linting! Found 136 violations, 0 serious in 54 files'"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*#' apps/ios/.swiftlint.yml | grep -cE '^\\s+error:\\s*[0-9]' -> 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "lint job added to ios.yml; build gated on needs: [kit, lint]; real Actions run shows lint green and build starting only after it"
    requirement: LINT-03
    verification:
      - kind: other
        ref: "gh run view 33543278296 — lint completed 18:23:36Z, build started 18:23:43Z, both jobs conclusion=success"
        status: pass
      - kind: other
        ref: "grep -nE '^\\s+needs: \\[kit, lint\\]' .github/workflows/ios.yml"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every disabled_rules entry in .swiftlint.yml and every --disable directive in .swiftformat carries a reason comment; no bare list"
    requirement: LINT-04
    verification:
      - kind: other
        ref: "manual read-through of apps/ios/.swiftlint.yml and apps/ios/.swiftformat at commit ec49445"
        status: pass
    human_judgment: false
  - id: D4
    description: ".swiftformat authored, apps/ios formatted once (44/54 files), format gate added to the lint job ahead of the SwiftLint step"
    requirement: LINT-01
    verification:
      - kind: other
        ref: "ssh macbuild: swiftformat Rawkoon Sources Tests --lint (apps/ios, sha ec49445) -> '0/54 files require formatting'"
        status: pass
      - kind: other
        ref: "gh api .../jobs/<lint-job-id>/logs (run 33544854087) contains '0/54 files require formatting.' and 'Done linting! Found 140 violations, 0 serious in 54 files.'"
        status: pass
    human_judgment: false
  - id: D5
    description: "Phase definition of done: swift test green on Linux CI, xcodebuild build green on macbuild at the verified pushed sha, no user-visible change"
    verification:
      - kind: other
        ref: "ssh macbuild at sha ec49445: swift test -> 14 suites, 0 failures; xcodebuild build -> '** BUILD SUCCEEDED **'"
        status: pass
    human_judgment: true
    rationale: "No-user-visible-change is a visual/behavioral claim over 44 reformatted files; automated checks (build succeeds, tests pass, only two view-identity rules explicitly kept off) support it strongly, but a human sign-off on the actual screens is the fail-safe for a claim this broad."

duration: 33min
completed: 2026-09-01
status: complete
---

# Phase 1 Plan 1: Lint and format guardrails Summary

**SwiftLint 0.65.1 and SwiftFormat 0.63.0 wired into ios.yml as a `lint` job gating `build`, with measured (not guessed) warning-only size thresholds and a one-time reformat of 44 Swift files.**

## Performance

- **Duration:** ~33 min
- **Started:** 2026-09-01T18:17:00Z (approx, from STATE.md's last_updated at session start)
- **Completed:** 2026-09-01T18:50:00Z
- **Tasks:** 3
- **Files modified:** 47 (2 new configs, 1 workflow, 44 Swift files reformatted)

## Accomplishments

- `apps/ios/.swiftlint.yml` committed with size thresholds measured directly on macbuild (SwiftLint 0.65.1) rather than guessed: `file_length` 1500, `type_body_length` 1400 (measured max span 1325, `MediaDetailView.swift`'s struct body), `function_body_length` 100 (measured max span 76, `DebugScreens.swift`). `identifier_name`/`large_tuple` demoted to warning-only, clearing the 59 pre-existing error-severity violations (58 `identifier_name`, 1 `large_tuple` at `APIClient.swift:600`) without touching a line of Swift.
- A `lint` job added to `.github/workflows/ios.yml`, running on `ubuntu-latest` in parallel with `kit`; `build`'s `needs:` changed from `kit` to `[kit, lint]`. Verified end-to-end on a real Actions run (33543278296): `lint` succeeded, its log shows SwiftLint's `Done linting!` summary, and `build` started only after `lint` concluded.
- `apps/ios/.swiftformat` committed (`--swiftversion 5.0` mirroring `project.yml`; `redundantSwiftUIGroup` and `redundantViewBuilder` disabled with reasons, since both change a SwiftUI view's static type). The tree was formatted once via `swiftformat Rawkoon Sources Tests` on macbuild (SwiftFormat upgraded 0.62.1 -> 0.63.0 to match what CI installs), touching 44 of 54 files — landed as its own commit, separate from the config commit.
- The format gate (`swiftformat Rawkoon Sources Tests --lint`) added to the `lint` job ahead of the SwiftLint step. Verified on a second real Actions run (33544854087): both steps green, log shows `0/54 files require formatting.` and `Done linting! Found 140 violations, 0 serious in 54 files.`
- macbuild confirmed at the final pushed sha (`ec49445`): `swift test` — 0 failures across all 14 `RawkoonKitTests` suites (72 tests); `xcodebuild build` for the simulator — `** BUILD SUCCEEDED **`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Measure the real size-rule worst cases on macbuild, then author .swiftlint.yml** - `5f3c6a3` (feat)
2. **Task 2: End-to-end "a lint violation fails CI" — one path only** - `7969f82` (feat)
3. **Task 3: Format the tree once with SwiftFormat and add the format gate to the lint job** - `b8f5ec8` (style, the reformat) + `ec49445` (feat, config + gate)

**Pre-task housekeeping commit** (not a plan task, required before any push): `bcc6f97` (merge: sync with origin/main — an unrelated README-screenshot commit had landed on origin between planning and execution)

_Note: Task 3 produced two commits by design — the plan requires "the formatting change is a separate commit from the config commit."_

## Files Created/Modified

- `apps/ios/.swiftlint.yml` - warning-only size rules, reasoned disabled_rules, identifier_name/large_tuple demotions
- `apps/ios/.swiftformat` - default rule set minus two SwiftUI view-identity rules
- `.github/workflows/ios.yml` - new `lint` job; `build`'s `needs:` widened to `[kit, lint]`
- 44 `.swift` files under `apps/ios/Rawkoon`, `apps/ios/Sources/RawkoonKit`, `apps/ios/Tests/RawkoonKitTests` - SwiftFormat output only (brace/whitespace normalization, `#if DEBUG` block reindentation in `DebugScreens.swift`); no logic changed

## Measurement Record (required by plan `<output>` — read by 01-02 and Phase 6's VM-04)

- **macbuild SwiftLint version:** 0.65.1
- **macbuild SwiftFormat version:** 0.63.0 (upgraded from 0.62.1 via `brew upgrade swiftformat` during Task 3, to match what the CI job's unpinned `brew install` resolves)
- **Max type-body span:** 1325 lines — `apps/ios/Rawkoon/Views/MediaDetailView.swift` (struct body) — rounded up to next multiple of 100 -> `type_body_length: warning: 1400`
- **Max function-body span:** 76 lines — `apps/ios/Rawkoon/Views/DebugScreens.swift` — rounded up to next multiple of 25 -> `function_body_length: warning: 100`
- **Final three size-rule thresholds:** `file_length: 1500`, `type_body_length: 1400`, `function_body_length: 100` (all warning-only, no `error:` key on any)
- **Error-severity rule tally (pre-wiring inventory):** 59 total — 58 `identifier_name` (short loop/closure bindings and `CodingKeys` underscore names), 1 `large_tuple` (`APIClient.swift:600`, a 3-member tuple). Neutralized by demoting `identifier_name`'s `min_length` to `warning: 3` with `allowed_symbols: ["_"]`, and `large_tuple` to `warning: 2` — both warning-only, no Swift source touched.
- **Verified sha (macbuild, `git log --oneline -1`):** `ec49445 feat(01-01): add .swiftformat and gate the lint job on it`

All four numbers matched the pre-measurement recorded in the plan (taken at planning time with SwiftLint 0.63.2 on Linux) exactly — macbuild's SwiftLint 0.65.1 confirmed the same worst offenders and the same error tally.

## Decisions Made

- Adopted every decision (D-A through D-G) as fixed in the plan frontmatter; no new architectural decisions were needed during execution.
- macbuild's SwiftFormat needed an explicit `brew upgrade` before running the formatting pass — its 0.62.1 install would have formatted differently than the 0.63.0 CI installs fresh, which would have made the CI `--lint` step immediately red against a tree formatted by the older binary. This was already anticipated in the plan's action text and executed as written, not a deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Local main had diverged from origin/main before any push was possible**
- **Found during:** pre-Task-1 setup, before the first push
- **Issue:** `origin/main` carried one commit (`7eef3a9`, an automated README-screenshot update, `[skip ci]`) that wasn't in local `main`, while local `main` was 10 commits ahead on the planning docs. A direct push would have been rejected as non-fast-forward.
- **Fix:** `git merge origin/main` — a clean, non-conflicting merge (screenshots vs. planning docs touch disjoint files).
- **Files modified:** `docs/screenshots/dashboard.png`, `docs/screenshots/library.png` (binary, unrelated to this plan)
- **Verification:** Merge completed with no conflicts; `git push origin main` succeeded immediately after.
- **Committed in:** `bcc6f97`

**2. [Rule 3 - Blocking] `git rev-parse --abbrev-ref HEAD` on macbuild resolved to whatever branch macbuild happened to be on, not `main`**
- **Found during:** Task 1's first measurement attempt
- **Issue:** The plan's action text says "hard-checkout the branch this work is on," but computing that branch name *on macbuild* picks up macbuild's local checkout state (it was sitting on `feat/ios-audio-session-and-car`), not the branch this executor is working on. The first measurement run silently linted the wrong branch at the wrong sha (`e6d0bdf`, not `bcc6f97`).
- **Fix:** Hardcoded `main` in every macbuild ssh invocation for this plan (`git checkout -q -B main origin/main`) instead of deriving the branch name from macbuild's ambient state, and always printed+checked the sha before trusting any tool output.
- **Files modified:** none (process fix, not a repo change)
- **Verification:** Every subsequent measurement and build run on macbuild printed a sha matching the sha just pushed before proceeding.
- **Committed in:** n/a (execution-process fix)

**3. [Rule 3 - Blocking] `swiftformat --lint <paths>` mis-parses when `--lint` precedes the path arguments**
- **Found during:** Task 3, first verification attempt
- **Issue:** `swiftformat --lint Rawkoon Sources Tests` fails with `error: --lint argument does not expect a value.` — SwiftFormat's CLI attempts to consume the first following token as `--lint`'s value.
- **Fix:** Reordered to `swiftformat Rawkoon Sources Tests --lint` (paths first, flag last) in both the manual verification command and the CI workflow step.
- **Files modified:** `.github/workflows/ios.yml`
- **Verification:** `swiftformat Rawkoon Sources Tests --lint` on macbuild reports `0/54 files require formatting.` with exit 0; the same invocation succeeded on the real Actions run (33544854087).
- **Committed in:** `ec49445`

**4. [Rule 1 - Bug] Stale uncommitted formatting output on macbuild's working tree blocked a branch checkout**
- **Found during:** Task 3's final build/test verification
- **Issue:** Task 3's earlier formatting-pass step left macbuild's working tree with uncommitted modified `.swift` files (the same reformat that had already been committed locally as `b8f5ec8`). A subsequent `git checkout -q -B main origin/main` at the newer sha (`ec49445`) aborted with "Your local changes... would be overwritten by checkout," leaving the verification running against the stale sha `7969f82` instead of `ec49445` — which would have silently failed the plan's own `fails_when` check ("the printed sha is not the sha just pushed").
- **Fix:** `git checkout -- apps/ios` on macbuild to discard the stale uncommitted mirror before re-fetching and re-checking-out `origin/main`.
- **Files modified:** none (macbuild working-tree state only, not a repo change)
- **Verification:** Re-run printed sha `ec49445`, matching the pushed HEAD, before `swift test`/`xcodebuild build` ran.
- **Committed in:** n/a (execution-process fix)

---

**Total deviations:** 4 auto-fixed (3 blocking, 1 bug) — all execution-process issues, no scope creep, no change to any acceptance criterion.
**Impact on plan:** None of the four required a plan or architecture change; all were mechanically fixed within the current task before proceeding.

## Issues Encountered

- Pushing to `main` (required by Task 2 and Task 3 to get a real Actions run) also triggers `ios.yml`'s existing `testflight` job, since that job runs unconditionally on any push to `main` that touches `apps/ios/**` or the workflow file. This plan's two pushes (`7969f82`, `ec49445`) each produced a full `kit`+`lint`+`build`+`testflight` run; both `testflight` jobs are real TestFlight uploads that consume a build number apiece. This is pre-existing CI behavior (see `.claude/memory/rawkoon-release-auto-deploys.md`'s sibling note on auto-deploy, and `ios.yml`'s own `testflight.if` condition), not something this plan introduced or could avoid while satisfying its own verification requirement to "confirm on the real Actions run." The first run's `testflight` job completed `success`; the second run's `testflight` job was still `in_progress` (uploading) as of this SUMMARY's writing — `kit`, `lint`, and `build`, the three jobs this plan's acceptance criteria actually gate on, were all `success` on both runs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `apps/ios/.swiftlint.yml` and `apps/ios/.swiftformat` are in place with measured, documented thresholds — 01-02 (logging) and 01-03 (log-retrieval docs) can add `Logging.swift` and its call sites without re-deriving any of this phase's numbers.
- The `lint` job gates `build` (and transitively `testflight`) on both tools staying green — 01-02's new `Logging.swift` and its modified call sites will be linted and format-checked automatically on the next push.
- Phase 6's `VM-04` should read this SUMMARY's Measurement Record before ratcheting `file_length` down further, rather than re-measuring from scratch.
- No blockers. The 2nd run's `testflight` job (upload/distribute) was still in flight at summary time — not a gate for this plan, but worth a glance before assuming both consumed build numbers cleanly.

---
*Phase: 01-lint-format-and-logging-guardrails*
*Completed: 2026-09-01*
