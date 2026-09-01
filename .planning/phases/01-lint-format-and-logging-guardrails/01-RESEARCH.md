# Phase 1: Lint, format, and logging guardrails - Research

**Researched:** 2026-09-01
**Domain:** iOS tooling (SwiftLint/SwiftFormat CI gating) + `os.Logger` structured logging on an existing 13k-line SwiftUI app with zero prior lint/format/logging infrastructure
**Confidence:** HIGH for versions, mechanisms, and repo facts (all directly verified this session); MEDIUM for the exact `type_body_length`/`function_body_length` threshold values (see Open Questions — these need a macbuild measurement this research host cannot perform); LOW/ASSUMED for nothing load-bearing — the two genuinely unresolved items are flagged as open questions with recommendations, not asserted as fact.

## Summary

This phase adds two things to a codebase that currently has neither: a `lint` job (SwiftLint 0.65.1 + SwiftFormat 0.63.0, both installed via `brew`, matching the existing `xcodegen` install pattern in `ios.yml`) gating the expensive `build`/`testflight` jobs, and a five-category `os.Logger` surface covering the 56 silently-discarded `try?` sites in the app target. Neither the linter nor the logger exists anywhere in the repo today — this is greenfield adoption on an app that was never gated, which changes the risk profile from "add a rule" to "adopt a rule while accepting that the codebase already violates the tool's defaults." `MediaDetailView.swift` (1,443 lines) already exceeds SwiftLint's default `file_length` **error** threshold (1,000) by 44%, and `BookView.swift` (1,227) by 23% — confirmed by direct line count this session, not inherited from the audit. This is exactly why LINT-02 requires `warning:`-only thresholds with no `error:` key: a default-config `swiftlint lint` would fail CI today, before a single refactor line is touched.

The central technical finding, verified by reading SwiftLint's current `SeverityLevelsConfiguration.swift` source directly (not inferred from an old bug report): supplying only a `warning:` key and omitting `error:` entirely **does** fully disable the error threshold in the pinned 0.65.1 release. A community-reported defect from October 2024 (SwiftLint 0.57.0, GitHub issue #5822) claimed this exact configuration was broken — that defect is resolved on current `main`/0.65.1. LINT-02's literal wording ("sets a `warning:` key and no `error:` key") is achievable exactly as written; the plan does not need a workaround.

The second central finding: SwiftLint's `--strict` flag does not promote individual rule severities from warning to error — it makes the whole `swiftlint lint` invocation exit non-zero if **any** warning is present, of **any** rule, anywhere in the scanned paths. On a codebase adopting SwiftLint for the first time, with ~150 built-in rules most of which default to warning severity, `--strict` on day one is very likely to fail CI on rules nobody has looked at yet (naming conventions, `line_length`, trailing whitespace, etc.) — a scope explosion this MVP-mode, no-user-visible-change phase cannot absorb. Recommendation: do not enable `--strict` in this phase (see Open Questions §1).

Third finding, directly relevant to LOG-03/criterion 4's verification method: Xcode sets `OS_ACTIVITY_DT_MODE` on any process it launches or debugs, which disables `os.Logger` privacy redaction **at write time**, for every field, regardless of `.public`/`.private` annotation. If the phase's manual verification runs the app via Xcode's Run/Debug button, "the failure appears readable, not `<private>`" will be true whether or not the privacy annotations were written correctly — the test proves nothing. Launching via `xcrun simctl launch` (no debugger attached) preserves normal redaction and makes the criterion 4 check meaningful. This is a load-bearing pitfall for how the plan writes its verification task.

**Primary recommendation:** Adopt SwiftLint 0.65.1 + SwiftFormat 0.63.0 via `brew install swiftlint swiftformat` in a new `lint` job that `build` gains a `needs:` on; configure `.swiftlint.yml` with `file_length`/`type_body_length`/`function_body_length` as `warning:`-only (confirmed achievable, not a defect); do not set `strict: true`; scope LOG-02's "download path" to `ChapterDownloader.swift` + `FileStore.swift` + `AppModel.swift`'s download-orchestration methods (9 `try?` sites total, not all 56); and verify criterion 4 by launching the app via `simctl launch`, never via Xcode's debugger.

## Architectural Responsibility Map

This is a single-tier native client (no SSR/CDN tiers apply); the map below substitutes the app's own architectural seams for the generic web-tier table.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Style/size guardrail enforcement | CI (`lint` job, `.github/workflows/ios.yml`) | — | Must gate `build`/`testflight` before they spend macOS runner minutes; this is the phase's own goal statement |
| Style config source of truth | Repo config (`.swiftlint.yml`, `.swiftformat`) | XcodeGen (`project.yml`) | `project.yml` regenerates `Rawkoon.xcodeproj` on every CI run and every `macbuild` check — hand-edited `.xcodeproj` settings are silently discarded |
| Structured logging surface | App target (`Rawkoon/`) via 5 `Logger(subsystem:category:)` instances | OS unified logging (storage, redaction, retrieval) | The app only decides *what* to log and *how public*; the OS decides storage, buffering, and enforces (or bypasses, under a debugger) redaction |
| Download failure diagnostics | `ChapterDownloader.swift`, `FileStore.swift`, `AppModel.swift` (download orchestration methods) | OS unified logging (persists across restarts, retrievable via `sysdiagnose`) | This is the concrete code surface criterion 3/4 verify against |
| Playback failure diagnostics | `AudiobookPlayer.swift` | OS unified logging | Separate `playback` category; only 2 `try?` sites here, both narrow |
| Privacy redaction | OS (unified logging, write-time redaction) | App (`.public`/`.private` annotations per interpolation) | The app requests visibility; the OS enforces it — and un-enforces it entirely under `OS_ACTIVITY_DT_MODE` (Xcode debugger), a fact the verification method must account for |
| Log retrieval / field diagnosis | Human operator (manual `sysdiagnose`, `log collect --device-udid`, `simctl spawn booted log show`) | `apps/ios/docs/` (LOG-04's new page) | No remote log aggregation exists in this app; retrieval is manual by design at this milestone's scope |

## Project Constraints (from CLAUDE.md)

Both `./CLAUDE.md` (repo-wide) and `./.claude/CLAUDE.md` (this milestone's own, already carrying prior research) are load-bearing. Extracted directives this phase must honor:

**From `/home/samuelloranger/sites/rawkoon/CLAUDE.md` (repo-wide):**
- Bun is the JS/TS package manager for the JS workspaces; irrelevant to `apps/ios` directly, but `scripts/asc-distribute.mjs` (Node, run from the `testflight` job) lives under `apps/ios/scripts` and is out of this phase's scope.
- Biome covers `apps/web`/`apps/api` only — does not touch Swift; no conflict.

**From `apps/ios/.claude/CLAUDE.md` (milestone-specific, authoritative for this whole milestone):**
- **Verification**: `macbuild` ssh host is the only real gate. Linux CI builds `RawkoonKit` alone (confirmed this session: `ios.yml`'s `kit` job runs `swift test` on `ubuntu-latest`, touching only `Sources/RawkoonKit`/`Tests/RawkoonKitTests` — it never builds the `Rawkoon` app target). No phase is done on a green Linux run alone.
- **Shippability**: the app must archive and upload to TestFlight after every phase — this phase's `testflight` job (unchanged by this phase except gaining an upstream `needs:` chain through `lint`) must still succeed.
- **Behavior**: zero user-visible change, including layout/wording, until the localization phase (Phase 7). Converting `try?` to `do/catch` must not alter behavior — only add a log line or a comment.
- **Tech stack**: SwiftUI, iOS 18 deployment target (confirmed: `project.yml` `deploymentTarget.iOS: "18.0"`), Xcode 26 SDK, XcodeGen, Readium 3.11.0 pinned, no new third-party dependencies except the lint/format toolchain (SwiftLint + SwiftFormat, both Homebrew formulae, not SPM dependencies — they never touch `Package.swift` or `project.yml`'s `dependencies:`).
- **Build settings**: edited in `project.yml`, never in a generated `.xcodeproj` — confirmed no `.xcodeproj` is committed to the repo (XcodeGen regenerates it fresh in every CI job and on `macbuild`), so there is nothing to accidentally edit in the wrong place; `project.yml` is the only place build settings can live.
- **Ordering**: guardrails (lint, logging) before the large refactors — this *is* Phase 1, first in the roadmap, depends on nothing.
- **Compatibility**: no migration of on-device state — irrelevant to this phase (no data model or storage-key changes).
- Prior research in `.claude/CLAUDE.md` already fixed: SwiftLint 0.65.1 / SwiftFormat 0.63.0, brew (not Mint, not SPM plugin) install method, "SwiftFormat is sole autocorrect authority, SwiftLint report-only" (i.e., no `swiftlint --fix` in CI), `os.Logger` subsystem `cloud.samlo.rawkoon`, privacy-annotation mechanics, and log-retrieval commands. **This research verifies and extends that baseline against the actual repo below — where it holds, it is cited as prior art; where the repo requires more precision (the exact `try?` inventory, the `--strict` interaction, the `OS_ACTIVITY_DT_MODE` verification pitfall), that is new to this pass.**

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LINT-01 | `.swiftlint.yml` and a SwiftFormat config committed under `apps/ios`, both run clean over `Rawkoon/`, `Sources/`, `Tests/` | Confirmed no config exists yet (greenfield). Source roots verified: `apps/ios/Rawkoon`, `apps/ios/Sources/RawkoonKit`, `apps/ios/Tests/RawkoonKitTests`. See Standard Stack, Code Examples. |
| LINT-02 | `file_length`/`type_body_length`/`function_body_length` as warnings, thresholds just above today's worst offenders | Worst-file line counts verified (`MediaDetailView` 1443, `BookView` 1227). Warning-only YAML syntax verified against current SwiftLint source (works, unlike the 0.57.0-era bug). `type_body_length`/`function_body_length` thresholds are an Open Question — need a macbuild measurement. |
| LINT-03 | `lint` job fails build on lint/format violation, runs before macOS jobs | `ios.yml` job graph read in full; exact `needs:` wiring given in Architecture Patterns. `--strict` interaction analyzed in Open Questions §1. |
| LINT-04 | Every `disabled_rules` entry has a reason comment, no blanket dump | Pattern given in Code Examples; no existing precedent in this repo (Biome configs in other workspaces don't use a comparable disable-with-reason convention to borrow from). |
| LOG-01 | Single `Logger(subsystem: "cloud.samlo.rawkoon", category:)` surface, 5 categories | Confirmed zero existing `os.Logger`/`OSLog`/`print(` usage in `Rawkoon/`. Domain-to-file mapping given in Architectural Responsibility Map and Code Examples. |
| LOG-02 | Every `try?` in download/playback path logged or commented | All 56 `try?` sites enumerated with file:line this session. Scoped down to the 9 sites that are literally "`AudiobookPlayer.swift` and the download path" — see Runtime State Inventory-style enumeration in Common Pitfalls §3 and Open Questions §3. |
| LOG-03 | No bearer token/password/full credentialed URL logged; explicit privacy annotations | Bearer token call site found (`APIClient.swift:400`). Signed/grant chapter URL risk found (`ManifestChapter.url`, `ChapterDownloader.swift` grant-refresh comments). Privacy annotation syntax and defaults verified via WebSearch against Apple's `OSLogPrivacy` docs and corroborating sources. |
| LOG-04 | `docs/` page with device/simulator log-pull commands | Command sequence given in Code Examples; `apps/ios/docs/` already exists (holds `code-quality-audit.md`), so this is a new file there, not a new directory. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SwiftLint | **0.65.1** [VERIFIED: GitHub Releases API `api.github.com/repos/realm/SwiftLint/releases/latest`, checked this session — `"tag_name": "0.65.1", "published_at": "2026-08-21T20:29:47Z"`] | Static style/complexity linting | The only maintained Swift linter; realm/SwiftLint, 10+ years old (created 2015-05-16), 19,717 GitHub stars, not archived [VERIFIED: GitHub Repos API, checked this session] |
| SwiftFormat | **0.63.0** [VERIFIED: GitHub Releases API `api.github.com/repos/nicklockwood/SwiftFormat/releases/latest`, checked this session — `"tag_name": "0.63.0", "published_at": "2026-08-30T19:34:36Z"`] | Deterministic autoformatting | 9+ years old (created 2016-08-22), 8,923 stars, not archived [VERIFIED: GitHub Repos API, checked this session]. Two days old at research time — `0.62.1` (2026-07-07) is the documented fallback if it proves unstable |
| `os.Logger` (Apple system framework) | iOS 18 SDK, no version to pin | Structured, privacy-aware logging | Apple's own replacement for `print`/legacy `os_log`; zero install cost, already implicitly available (no `import os` currently present anywhere in `Rawkoon/` — confirmed by grep this session) |

### Installation

```bash
# In the new `lint` CI job (macos-26 runner, matches the existing xcodegen pattern):
brew install swiftlint swiftformat

# os.Logger needs no installation — `import os` is part of the iOS 18 SDK.
```

**Version verification performed this session** (not inherited from `.claude/CLAUDE.md` without checking): both versions above were re-confirmed today via direct GitHub Releases API calls, not WebSearch or training data. They match the prior milestone research exactly — that baseline was correct and needed no correction.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| brew install (per-job, unpinned) | Mint (`mint run realm/swiftlint@0.65.1`) | Reproducible pin, but introduces a tool dependency the rest of `ios.yml` doesn't have — the existing `xcodegen` install already sets the "trust brew's current formula" convention; matching it is lower-friction for this size of project |
| brew install | SwiftLint SPM build-tool plugin | Slows every **local** Xcode build (not just CI), and SwiftLint's prerelease `swift-syntax` pin currently defeats Xcode 26's prebuilt-module cache on clean builds — a real, not theoretical, cost documented in SwiftLint issue #6574 |
| `os.Logger` | A third-party logging library (CocoaLumberjack, SwiftyBeaver, etc.) | Explicitly forbidden by this milestone's constraint: "no new third-party dependencies except the lint and format toolchain." `os.Logger` is the only compliant option and is also the 2026 Apple-recommended default |

## Package Legitimacy Audit

Not applicable in the npm/pypi/crates sense — the only two packages this phase adds are Homebrew formulae, not Swift Package Manager or app dependencies, and they never appear in `Package.swift` or `project.yml`'s `dependencies:` list. The standard `package-legitimacy check` seam targets npm/pypi/crates registries and does not cover Homebrew; a manual assessment is substituted:

| Package | Registry | Age | Stars | Source Repo | Verdict | Disposition |
|---------|----------|-----|-------|-------------|---------|-------------|
| swiftlint | Homebrew formula / GitHub `realm/SwiftLint` | 10+ yrs (created 2015-05-16) | 19,717 | github.com/realm/SwiftLint | OK | Approved |
| swiftformat | Homebrew formula / GitHub `nicklockwood/SwiftFormat` | 9+ yrs (created 2016-08-22) | 8,923 | github.com/nicklockwood/SwiftFormat | OK | Approved |

**Packages removed due to SLOP verdict:** none.
**Packages flagged as suspicious (SUS):** none. Both tools are the de facto, unrivaled standard for this exact purpose in the Swift ecosystem and are already named in this milestone's own prior research and in the audit document's own "Recommended order" table (`apps/ios/docs/code-quality-audit.md`).

## Architecture Patterns

### CI Job Graph — verified from `.github/workflows/ios.yml` (read in full this session)

```
push/PR on apps/ios/** or ios.yml
        │
        ▼
   ┌─────────┐
   │  kit    │  ubuntu-latest, swift-actions/setup-swift@v2 (6.0)
   │         │  `swift test` in apps/ios (RawkoonKit + RawkoonKitTests only)
   └────┬────┘
        │ needs: kit
        ▼
   ┌─────────┐
   │  build  │  macos-26, selects Xcode 26, `brew install xcodegen`,
   │         │  `xcodegen generate`, `xcodebuild build` (simulator, unsigned)
   └────┬────┘
        │ needs: build
        ▼
   ┌───────────┐
   │ testflight│  macos-26, gated on push-to-main OR workflow_dispatch,
   │           │  archives, signs, uploads to App Store Connect,
   │           │  distributes to internal testers
   └───────────┘
```

**Where `lint` slots in, per LINT-03's exact wording ("runs before the expensive macOS `build` job... `build` gains a `needs:` on it")**: insert a new `lint` job with no `needs:` (so it runs in parallel with `kit`, both being cheap/fast — `kit` is `ubuntu-latest`, and `lint` should also run on a cheap runner if possible), then change `build`'s `needs: kit` to `needs: [kit, lint]`. SwiftLint and SwiftFormat are macOS-only tools in practice for this codebase's linting target (they *can* run on Linux via SourceKit workarounds, but this is not a supported/tested path in this repo, and the existing `kit` job's `ubuntu-latest` runner doesn't have Xcode or the Rawkoon app-target sources compiled) — however, **both tools only need to read Swift source text, not compile it**, so `swiftlint lint` and `swiftformat --lint` do not require a compiled build or the iOS SDK at all. This means `lint` could run on `ubuntu-latest` via `brew` (Homebrew is Linux-installable) rather than costing a `macos-26` runner slot. This is a genuine option worth the planner's attention: it would keep `lint` cheap and fast in the same tier as `kit`, rather than consuming a `macos-26` minute-multiplier runner for a job that will run on every push.

**Recommendation:** run `lint` on `ubuntu-latest` with `brew install swiftlint swiftformat` (Homebrew works on Linux CI runners), not `macos-26`. This is faster to provision, cheaper per GitHub Actions minute-multiplier, and matches the spirit of "runs before the expensive macOS `build` job." Flag this as a decision point for the plan since it isn't explicitly stated in the roadmap text (which only says "ordered before" — not which runner). If SwiftLint's SourceKit-based rules misbehave on Linux (some Swift-syntax-dependent rules have had Linux-specific issues historically), the fallback is `macos-26` with no loss of correctness, just cost.

### Recommended `.swiftlint.yml` structure

```yaml
# apps/ios/.swiftlint.yml
included:
  - Rawkoon
  - Sources
  - Tests

# Every disabled rule below has a reason (LINT-04) — no reason, no disable.
disabled_rules:
  - todo
    # This phase and the six that follow are a debt-paydown milestone that
    # deliberately defers work (V2 items, phase-scoped follow-ups); TODO
    # comments are the intended trail for that, not a lint violation.

opt_in_rules:
  - unused_import
    # Not on by default; cheap and catches real dead-weight in a codebase
    # this size with no prior lint history.

file_length:
  warning: <N>   # see Open Questions §2 — pick in [1443, 1600]
  # No `error:` key: verified against SwiftLint's current
  # SeverityLevelsConfiguration.swift that omitting `error` while setting
  # `warning` fully disables the error threshold (fixed since the 0.57.0-era
  # bug reported in realm/SwiftLint#5822). LINT-02 requires this exact shape.

type_body_length:
  warning: <M>   # see Open Questions §2 — needs a macbuild measurement

function_body_length:
  warning: <K>   # see Open Questions §2 — needs a macbuild measurement

# strict: false (default) — do NOT set `strict: true` this phase.
# See Open Questions §1: --strict fails the whole invocation on ANY warning,
# which is incompatible with adopting SwiftLint for the first time on a
# 13k-line codebase with no prior lint history.
```

### `.swiftformat` config

```
# apps/ios/.swiftformat
--swiftversion 5.0
# Matches project.yml's current SWIFT_VERSION (5.0). Must be bumped in the
# same commit that bumps SWIFT_VERSION in a later phase (CONC-01/02), or
# SwiftFormat will apply syntax the compiler doesn't yet accept.
```

Kept minimal deliberately: this phase's constraint is zero user-visible/behavioral change, and SwiftFormat's default rule set is almost entirely whitespace/ordering — the risk is a large mechanical diff, not a wrong diff. The plan should apply `swiftformat` once (not `--lint`-only) to the whole target as part of the initial commit, matching LINT-01's own success criterion ("passes green... with no Swift source changed other than SwiftFormat's own output" — implying a SwiftFormat-only commit is expected and accounted for).

### Logger domain-to-file mapping

| Category | Primary file(s) | Rationale |
|----------|-----------------|-----------|
| `playback` | `Rawkoon/AudiobookPlayer.swift` | The 2 `try?` sites here (AVAudioSession deactivation, artwork fetch) |
| `download` | `Rawkoon/ChapterDownloader.swift`, `Rawkoon/FileStore.swift`, download-orchestration methods in `Rawkoon/AppModel.swift` (`startDownload`, `refreshGrants`, `deleteDownloads`, `applyDownloadPlan`) | The 9 in-scope `try?` sites for LOG-02/criterion 3; also criterion 4's concrete verification target |
| `network` | `Rawkoon/APIClient.swift` | Owns the bearer-token header and all HTTP request/response handling; LOG-03's token-redaction risk lives here |
| `auth` | Login/session code in `Rawkoon/AppModel.swift` (`login`, `signInWithProvider`, `logout`), `Rawkoon/WebAuth.swift`, `Rawkoon/Keychain.swift` | Verified these are the only auth-related files (31 and 44 lines respectively; `AppModel.swift` holds the actual login orchestration) |
| `sync` | Reading-progress persistence in `Rawkoon/AppModel.swift` (`persistPlaybackProgress`, `sendProgress`, `saveReadingPosition`) and RawkoonKit's `SyncReconciler`/`ReadingProgressReconciler` (already tested, pure logic — no logging needed *there*, but the call sites in `AppModel.swift` that consume their output are where `sync`-category logs belong) | Matches the vocabulary already established by `SyncReconciler.swift` |

### Code Examples

**Declaring the five loggers** (a single file, e.g. `Rawkoon/Logging.swift`):

```swift
// Source: pattern verified against Apple's OSLogPrivacy docs
// (developer.apple.com/documentation/os/oslogprivacy) and SwiftLee's
// os.Logger writeup, both cited in the prior milestone research.
import os

enum Log {
    private static let subsystem = "cloud.samlo.rawkoon"

    static let playback = Logger(subsystem: subsystem, category: "playback")
    static let download = Logger(subsystem: subsystem, category: "download")
    static let network = Logger(subsystem: subsystem, category: "network")
    static let auth = Logger(subsystem: subsystem, category: "auth")
    static let sync = Logger(subsystem: subsystem, category: "sync")
}
```

**Converting a download-path `try?` to a logged `do/catch`** (`FileStore.swift:60`, quoted verbatim above as `try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)`):

```swift
static func createDirectoryIfNeeded(_ url: URL) {
    do {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    } catch {
        // withIntermediateDirectories: true makes "already exists" a non-error
        // from FileManager's own perspective, so anything caught here is a
        // real filesystem problem (permissions, disk full) worth a log line.
        Log.download.error("Could not create directory \(url.path, privacy: .public): \(error, privacy: .public)")
    }
}
```

**Privacy-annotated failure log for criterion 4** (book/chapter id and HTTP status public, no URL logged at all):

```swift
// In ChapterDownloader.urlSession(_:downloadTask:didFinishDownloadingTo:),
// on the non-2xx branch (existing code at line ~188):
if !(200...299).contains(status) {
    Log.download.error(
        "Chapter download failed: editionId=\(self.editionId, privacy: .public) fileId=\(fileId, privacy: .public) status=\(status, privacy: .public)"
    )
    applyEventAndContinue(
        .completed(fileId: fileId, status: status, bytes: 0, sha256: nil),
        fileId: fileId
    )
    return
}
```

Note what is deliberately **absent**: the resolved chapter URL is never interpolated. `ManifestChapter.url` is a server-signed, time-limited grant (confirmed by `ChapterDownloader.swift`'s own comments: "A grant lasts seven days," "a server whose secret rotated" — this is a pre-authenticated URL, not a bare path). Logging it — even under `.public` — would be exactly the "credentialed server URL" criterion 4 forbids. `editionId`/`fileId` are safe, opaque integers with no embedded secret.

**Log retrieval commands for LOG-04's new doc page:**

```bash
# From the simulator (macbuild), while the app is running:
xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"' --level debug
xcrun simctl spawn booted log show --predicate 'subsystem == "cloud.samlo.rawkoon"' --last 5m

# From a real device (requires the device connected via cable/network and
# Xcode's Devices window, or the command line):
xcrun devicectl list devices                     # find the device UDID (Xcode 15+ toolchain)
log collect --device-udid <UDID> --output rawkoon.logarchive
# Or, without a Mac present: on-device Settings > Privacy & Security >
# Analytics & Improvements > Analytics Data, or a sysdiagnose
# (hold Volume Up + Volume Down + Side button briefly) — produces a full
# system diagnostic archive containing the unified log, not filterable by
# subsystem at capture time.
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Style/size enforcement | A custom script grepping line counts or naming conventions | SwiftLint | It already has `file_length`/`type_body_length`/`function_body_length` as first-class, independently-configurable rules — reinventing this in a shell script loses the `warning`/`error` severity model and Xcode/CI integration for free |
| Redacting sensitive values from logs | String-scrubbing/regex before logging | `os.Logger`'s built-in `privacy:` parameter | The OS enforces this at write time, in a way a hand-rolled scrubber (which runs in-process, before the OS layer) cannot guarantee is bypass-proof, and it's the mechanism Apple's own tooling (Console.app, `log show`) understands natively |
| Formatting consistency | Manual PR review comments about spacing/braces | SwiftFormat, autocorrect-on-write | Two tools autocorrecting the same files (SwiftFormat + SwiftLint) risks fight-loops — this milestone's own prior research already settled this: SwiftFormat is the sole autocorrect authority, SwiftLint stays report-only (no `--fix`/`--autocorrect` in CI) |

**Key insight:** this phase's entire value is in the CI job and the logger existing at all, not in the sophistication of either — both are stock configurations of stock tools. The genuine engineering judgment in this phase is scoping (which `try?` sites are actually "the download path," what threshold survives contact with today's file sizes) rather than building anything novel.

## Common Pitfalls

### Pitfall 1: `--strict` is incompatible with the warning-only size-rule design, and the incompatibility isn't superficial

**What goes wrong:** Someone reads LINT-03 ("fails the build on a lint or format violation") and reaches for `--strict` to make that literally true for every rule, not just error-severity ones.

**Why it happens:** `--strict` sounds like "upgrade severities to error," but it actually means "fail the whole command if any warning exists anywhere" [CITED: community consensus across SwiftLint GitHub issues #268, #3312, #834, cross-checked against the official README's documented behavior]. Combined with LINT-02's explicit requirement that `file_length`/`type_body_length`/`function_body_length` stay `warning:`-only forever (by design — they're meant to ratchet down gradually across the whole 7-phase milestone, not gate immediately), `--strict` would make *any* file crossing the newly-set threshold — even by one line, even on an unrelated later phase's work — fail CI immediately, defeating the "ratchet down gradually" intent. Worse, on a codebase with zero prior lint history, dozens of unrelated default-severity-warning rules (naming, `line_length`, `todo`, etc.) will almost certainly also be triggering right now, and `--strict` would fail on all of them simultaneously, not just the three size rules.

**How to avoid:** Do not set `strict: true` in `.swiftlint.yml` and do not pass `--strict` on the CLI in this phase. Let `swiftlint lint`'s default behavior — non-zero exit only on error-severity violations — be the CI gate. `swiftformat --lint` already fails the build on **any** formatting drift by itself (it doesn't have a warning/error distinction), so LINT-03's "fails on a lint or format violation" is fully satisfied for formatting, and satisfied for the specific error-severity lint rules this phase actually errors on (all remaining default-error rules, e.g. syntax-adjacent ones, plus anything the plan explicitly configures with an `error:` key).

**Warning signs:** if criterion 1's real CI run shows the `lint` job red on the very first commit (before any of the 9 `try?` conversions or logger additions), before the size rules even matter, `--strict` (or an accidentally-left-`error:` key) is almost certainly why.

### Pitfall 2: verifying criterion 4's privacy claim by running the app from Xcode proves nothing

**What goes wrong:** The natural way to "force a chapter download against a URL that 404s" on `macbuild` is to hit Run/Debug in Xcode, watch it happen, then check the log. This appears to satisfy "readable, not `<private>`" even if the `.public` annotations are missing or wrong.

**Why it happens:** Xcode sets the `OS_ACTIVITY_DT_MODE` environment variable on any process it launches or attaches a debugger to. This disables `os.Logger`'s privacy redaction entirely, for every interpolated value, regardless of annotation — redaction happens at write time, and under `OS_ACTIVITY_DT_MODE` the write-time check is skipped [CITED: multiple corroborating Apple Developer Forums threads — "Xcode 15 Structured log always redacting `<private>` strings" and "Logging not redacting strings in Xcode," cross-checked; MEDIUM confidence — this is documented developer-forum consensus, not a single canonical Apple statement, but consistent across independent threads]. A log line showing a plaintext bearer token under this condition would look identical to a correctly-`.public`-annotated `fileId` — the test can't tell the two apart.

**How to avoid:** Verify criterion 4 by installing and launching the app via `xcrun simctl install booted <app path>` + `xcrun simctl launch booted cloud.samlo.rawkoon`, **not** via Xcode's Run button, before starting `log stream`. This keeps normal redaction rules in effect, so a `.public`-tagged `fileId`/`status` showing up in plaintext is meaningful, and — just as importantly — a forgotten `.public` annotation on something that should stay private would visibly show `<private>` instead of silently passing. Additionally, verify LOG-03 by reading the diff (grep for `Bearer`, `token`, `password`, `chapter.url`, `.url,` inside any `Log.*` call) rather than relying solely on what the simulator happens to display.

**Warning signs:** if the criterion-4 verification note in the plan says "ran via Xcode" or doesn't specify the launch method, treat it as unverified.

### Pitfall 3: "the download path" is not self-evident, and getting it wrong changes which `try?` sites the plan must touch

**What goes wrong:** LOG-02/criterion 3 says "`AudiobookPlayer.swift` and the download path," but nothing in the roadmap or requirements enumerates which files that means. All 56 `try?` sites were read this session (file:line list below); most of them are *not* in the download or playback path.

**Why it happens:** "Download" appears in multiple unrelated contexts in this codebase: `ChapterDownloader.swift` (audiobook chapter background downloads — clearly in scope), `Views/DownloadClientView.swift` (an admin screen showing the *external* torrent/download-client's speed — a completely different "download" concept, unrelated to book files), and ebook file downloads via bare `URLSession.shared.download` in `ContinueListeningView.swift`/`BookView.swift`/`DebugScreens.swift` (Phase 2's NET-01 territory — these use `try await`, not `try?`, so LOG-02 doesn't touch them regardless of scoping).

**How to avoid:** Scope "the download path" to exactly: `ChapterDownloader.swift` (1 `try?`, line 206), `FileStore.swift` (5 `try?`, lines 19/27/33/39/60 — used by both `ChapterDownloader` for storage and `AudiobookPlayer` for playback-time file checks, so it's unambiguously in scope either way), and `AppModel.swift`'s download-orchestration methods, specifically `refreshGrants` (1 `try?`, line 483). That is **9 sites total**, plus `AudiobookPlayer.swift`'s own 2 (lines 316, 887) — **11 sites** the plan must guarantee are each either logged or comment-justified. This is a small, closed, already-enumerated list — the plan does not need to touch the other 45 `try?` sites in this phase (`AppModel.swift`'s remaining 17, the 6 each in `HomeView.swift`/`EbookReaderView.swift`/`DebugScreens.swift`, etc.) to satisfy LOG-02 as literally worded, though nothing prevents doing more.

**Warning signs:** a plan that says "convert all 56 `try?` sites" is over-scoping a phase whose own success criteria only ask for two files' worth, and risks behavior changes in code this phase's own risk note doesn't cover (criterion 5 explicitly names playback-path `try?→do/catch` as *the* behavior risk — expanding scope multiplies that risk for no requirement benefit).

**All 56 `try?` sites, enumerated this session** (`grep -rn 'try?' apps/ios/Rawkoon --include="*.swift"`, count independently confirmed at exactly 56, matching the audit's claim):

```
Rawkoon/AudiobookPlayer.swift:316   (IN SCOPE — playback)
Rawkoon/AudiobookPlayer.swift:887   (IN SCOPE — playback)
Rawkoon/FileStore.swift:19          (IN SCOPE — download/playback shared)
Rawkoon/FileStore.swift:27          (IN SCOPE)
Rawkoon/FileStore.swift:33          (IN SCOPE)
Rawkoon/FileStore.swift:39          (IN SCOPE)
Rawkoon/FileStore.swift:60          (IN SCOPE)
Rawkoon/ChapterDownloader.swift:206 (IN SCOPE — download)
Rawkoon/AppModel.swift:483          (IN SCOPE — refreshGrants, download)
Rawkoon/AppModel.swift: 18 other sites at lines 20,155,173,243,259,408,513,600,610,620,622,636,658,666,679,688,727 (out of scope: auth/sync/misc, not download orchestration)
Rawkoon/Views/HomeView.swift: 6 sites (265,266,267,268,269,270) — out of scope
Rawkoon/Views/EbookReaderView.swift: 6 sites (55,63,172,358,475,503) — out of scope (ebook reader, not audiobook download/playback)
Rawkoon/Views/DebugScreens.swift: 6 sites (70,130,232,291,386,423) — out of scope, #if DEBUG-gated harness
Rawkoon/Views/ContinueListeningView.swift: 3 sites (191,192,305) — out of scope (reading-progress fetch)
Rawkoon/Models.swift: 2 sites (213,214) — out of scope (Codable decode fallback)
Rawkoon/Views/NotificationsSettingsView.swift:125, DownloadClientView.swift:162, DiscoverView.swift:403, BookView.swift:1130, BookReleaseSearchView.swift:148, ActivityView.swift:380, APIClient.swift:122 — out of scope (1 each)
```

## Runtime State Inventory

Not applicable — this is a greenfield tooling-adoption phase (new CI job, new config files, new logger), not a rename/refactor/migration. No stored data, service config, OS-registered state, secrets, or build artifacts carry a name that this phase changes. **Confirmed nothing to migrate:** grep for existing `.swiftlint.yml`/`.swiftformat` anywhere in the repo returned zero hits this session — there is no prior config to reconcile or migrate away from.

## Code Examples

See **Architecture Patterns** above for the `.swiftlint.yml`/`.swiftformat` skeletons, the Logger declaration, the `try?`-to-logged-`do/catch` conversion pattern, the privacy-annotated failure log, and the log-retrieval commands — all grouped there since each is tightly coupled to the pattern it demonstrates.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| No lint/format tooling at all | SwiftLint + SwiftFormat, brew-installed in CI | N/A — this phase introduces the first version, there is no "old" tooling to compare against | Establishes the baseline every later phase's file-size ratchet (VM-04 in Phase 6) depends on |
| No logging | `os.Logger` with subsystem/category structure | Apple's unified logging (`os.Logger`) has been the recommended API since iOS 14/WWDC20; this codebase simply never adopted it | Every future bug report gains a diagnosable trail; the 1.12.4 corrupt-cache bug (diagnosed only by deleting the app) is the audit's own cited motivating example |

**Deprecated/outdated:** legacy `os_log(_:log:type:)` (pre-`Logger` struct API) — not relevant here since the codebase has zero existing logging to migrate from; adopt the modern `Logger` struct directly, no migration path needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Running `lint` on `ubuntu-latest` (via Homebrew-on-Linux) rather than `macos-26` is viable for SwiftLint/SwiftFormat against this codebase | Architecture Patterns — CI Job Graph | If Linux-hosted SwiftLint chokes on a SourceKit-dependent rule or Homebrew-on-Linux has friction not seen for `xcodegen` (a much simpler tool), the plan falls back to `macos-26` at higher cost but no correctness loss — low risk, easily detected on the first CI run |
| A2 | Exact `type_body_length`/`function_body_length` warning thresholds cannot be picked without running SwiftLint (or a manual scan) on `macbuild`, since this Linux research host has no Swift toolchain, no `swiftlint`, and Swift's syntax makes a naive line-counting heuristic for type/function bodies unreliable (multi-line closures, nested types) | Open Questions §2 | If the plan picks arbitrary values without a macbuild measurement first, it risks either failing CI immediately (if too low) or providing no real ratchet (if too high) — should be a Wave-0 task: install SwiftLint on macbuild, run once with generous thresholds, read the actual violation report, then lock the real thresholds |
| A3 | "The download path" for LOG-02 scopes to `ChapterDownloader.swift` + `FileStore.swift` + `AppModel.swift`'s download-orchestration methods (9 sites), not all `try?` sites containing the word "download" in a nearby comment or the `DownloadClientView.swift`/ebook-download call sites | Common Pitfalls §3 | If this scoping is wrong, either too little is logged (criterion 3 fails a stricter grader's reading) or scope balloons back toward all 56 sites, reintroducing behavior risk in files (`EbookReaderView`, `HomeView`) this phase's own risk note doesn't flag |

## Open Questions

### 1. Does `--strict` gate the `lint` job from day one, or only after the warning count is driven down?

**What we know:** `--strict` fails the whole `swiftlint lint` invocation on any warning of any rule, not just the three size rules this phase configures [CITED, cross-checked across multiple SwiftLint GitHub issues]. LINT-02 requires the size rules to stay `warning:`-only permanently (they ratchet down across the whole 7-phase milestone, most visibly in VM-04/Phase 6). Combining "warning-only forever" with "`--strict` from day one" means the `lint` job would fail the moment *any* file anywhere in the 13k-line codebase crosses *any* default-warning rule, not just the three size rules this phase cares about — and this codebase has never been linted, so the actual current warning count across ~150 default rules is unknown without running SwiftLint on `macbuild` (not possible from this Linux research host).

**What's unclear:** whether "fails the build on a lint or format violation" (LINT-03's literal wording) requires `--strict` to be considered satisfied, or whether the roadmap's own success criterion 2 (which requires only "zero `error:`-severity violations," not zero warnings) already signals that non-strict mode is the intended reading.

**Recommendation:** Do not enable `--strict` in this phase. Rely on SwiftLint's default behavior (fails only on error-severity violations) plus `swiftformat --lint` (fails on any formatting drift, no warning/error distinction needed). This satisfies LINT-03 for formatting completely and for lint on the subset of rules that matter now. Treat "drive the warning count down, then flip `--strict` on" as an explicit follow-up not currently named in `REQUIREMENTS.md`'s v1 or v2 lists — the plan should note this as a deliberate deferral, not silently skip it. This reading is also the only one consistent with the roadmap's own criterion 2, which only requires zero *errors*, not zero warnings, on day one.

### 2. What `file_length`/`type_body_length`/`function_body_length` warning values should be picked?

**What we know:** `file_length`'s floor is fixed by the roadmap itself: `[1443, 1600]`, where 1443 is `MediaDetailView.swift`'s exact current line count (verified via `wc -l` this session, not the audit's number, though they agree). SwiftLint's *defaults* are `file_length` warning 400/error 1000, `type_body_length` warning 250/error 350, `function_body_length` warning 50/error 100 [CITED: realm.github.io rule reference pages — `file_length.html`, `type_body_length.html`, `function_body_length.html`]. `type_body_length` counts lines inside a type's body (not the whole file — a file can have multiple types), and `function_body_length` counts lines inside a single function — neither can be derived from a whole-file `wc -l`, and this research host has no Swift toolchain to run SwiftLint itself to get the real per-type/per-function violation report.

**What's unclear:** the actual worst-case `type_body_length` and `function_body_length` values in `MediaDetailView.swift`/`BookView.swift`/`AudiobookPlayer.swift` today — these determine what "just above today's worst offenders" (LINT-02's exact wording) means for these two rules, and cannot be responsibly estimated from a naive brace-counting heuristic given Swift's syntax (multi-line closures, nested types, trailing closures) makes that unreliable.

**Recommendation:**
- `file_length`: pick **1500** — a round number, comfortably above the 1443 floor (57-line buffer, small enough that it can only ratchet down as the milestone proceeds; well within the roadmap's mandated `[1443, 1600]` range).
- `type_body_length`/`function_body_length`: add a Wave-0 plan task — install SwiftLint on `macbuild`, run it once against `Rawkoon/` with these two rules set to a deliberately generous placeholder (e.g., `type_body_length: warning: 2000`, `function_body_length: warning: 500`) so the run completes without drowning in violations, capture the actual line-count report SwiftLint itself prints for the worst type and worst function, then set the final thresholds just above those real numbers — mirroring exactly the same "measure, then floor above the measurement" approach the roadmap mandates for `file_length`. Do not guess these two values from a heuristic; SwiftLint's own line-counting algorithm is the only correct source, and it requires the tool to actually run.

### 3. Which `try?` conversions are mechanically safest, and what's the minimum required set?

**What we know:** the minimum required set for LOG-02/criterion 3, as scoped in Common Pitfalls §3, is 11 sites: `AudiobookPlayer.swift` (2), `FileStore.swift` (5), `ChapterDownloader.swift` (1), `AppModel.swift`'s `refreshGrants` (1) — plus, if the "download path" reading is drawn slightly wider to include `AppModel.swift`'s other download-orchestration call sites for completeness, `startDownload`/`deleteDownloads`/`applyDownloadPlan` (which currently have **no** `try?` at all — `startDownload` already uses `do/catch`), so no additional sites are actually needed there.

**What's unclear:** for each of the 11 sites, whether logging is strictly better than a justifying comment (criterion 3 explicitly allows either). `FileStore.swift`'s 5 sites are almost all "best-effort cleanup" (`removeItem`, `setResourceValues` for backup-exclusion) where a failure is genuinely uninteresting most of the time — logging every one at `.error` severity could produce log noise during normal operation (e.g., `removeItem` on a file that may already not exist is not exceptional).

**Recommendation:** Convert to logged `do/catch` only where the failure is diagnostically useful (the 2 `ChapterDownloader`/`AppModel` sites tied directly to the actual download/grant-refresh flow — these are exactly what criterion 4's field scenario exercises). For `FileStore.swift`'s cleanup-oriented sites (delete, set-resource-values, create-directory), a one-line comment explaining why silent failure is acceptable (e.g., "best-effort backup-exclusion flag; a failure here doesn't affect correctness, only iCloud backup size") satisfies criterion 3's "or carries a comment" clause without adding noisy logging to paths that succeed 99.9% of the time. This is a judgment call the plan should make explicitly per-site, not uniformly.

### 4. How is criterion 4 verified end-to-end on `macbuild`?

**What we know:** the concrete command sequence, and the debugger-redaction pitfall that invalidates an Xcode-driven test (Common Pitfalls §2). `ChapterDownloader` downloads chapters via a signed `ManifestChapter.url`, resolved relative to the manifest's `baseURL` (the real, configured server) — there's no built-in "point this at a URL that 404s" toggle in production code, but `DebugScreens.swift` already contains a `#if DEBUG`-gated pattern for injecting a synthetic `BookManifest` via hand-built JSON (`DebugPlayer.syntheticManifest`), which demonstrates the mechanism the plan can reuse.

**Recommendation, concrete sequence:**
1. On `macbuild`, build for the simulator (`xcodegen generate && xcodebuild build -destination 'generic/platform=iOS Simulator' ...`, install the resulting `.app` with `xcrun simctl install booted <path-to-.app>`.
2. Launch via `xcrun simctl launch booted cloud.samlo.rawkoon` (NOT Xcode Run — see Pitfall 2).
3. Sign in to a real, reachable Rawkoon server from the running app.
4. Trigger a chapter download for a real audiobook edition where the *server itself* returns 404 for at least one chapter's file id — the simplest reliable way is to pick an edition, capture its real manifest via the API, then use the app's existing debug/test harness pattern (or a temporary one-off edit, reverted after verification) to substitute one chapter's `fileId` with a value the server doesn't have a file for, so `ChapterDownloader`'s background `URLSessionDownloadTask` receives a real HTTP 404 from the real server (not a DNS failure from an unreachable host, which would exercise the "transport failed" path, not the "non-2xx status" path this specific criterion needs).
5. In a separate terminal, start `xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"'` *before* step 4, so nothing is missed.
6. Confirm the emitted log line shows `editionId`/`fileId`/`status=404` as plain values (not `<private>`), and grep the diff for `Bearer`/`token`/`chapter.url` inside any `Log.*` call to independently confirm nothing credentialed is interpolated (don't rely on visual inspection of the log output alone — see Pitfall 2).

### 5. Privacy annotation syntax and defaults

**What we know, verified this session:** `os.Logger` string interpolation defaults to `.private` (redacted) for `String`/object types, but numeric types (`Int`, `Double`, `Bool`, `Float`) are **public by default**, unredacted, unless explicitly marked `.private` [CITED: Apple's `OSLogPrivacy` docs, cross-checked against SwiftLee and other independent sources via WebSearch this session]. Explicit syntax: `logger.error("… \(value, privacy: .public) …")` / `\(value, privacy: .private)`. This means the criterion-4 log line's `editionId`/`fileId`/`status` (all `Int`) would actually print in plaintext **even with no annotation at all** — the `.public` annotations in the Code Examples above are for clarity/self-documentation, not strictly required for these particular fields, but should be added anyway so a future refactor that changes a field's type doesn't silently start redacting it.

**What's unclear:** nothing load-bearing remains — the mechanism is well-documented and cross-checked from multiple sources. The one genuine subtlety (the `OS_ACTIVITY_DT_MODE`/Xcode-debugger bypass) is covered in Common Pitfalls §2, not here, since it's a verification-methodology issue rather than an annotation-syntax one.

## Environment Availability

| Dependency | Required By | Available (this research host) | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Swift toolchain | Everything in this phase | ✗ (Linux research host has no `swift`, confirmed via `command -v swift`) | — | All verification must happen on `macbuild` per this milestone's own constraint — this is expected, not a gap |
| Homebrew | `swiftlint`/`swiftformat`/`xcodegen` install | ✗ (not present on this Linux host; irrelevant — CI/`macbuild` both have it) | — | N/A — CI runners and `macbuild` already have brew |
| `xcodebuild`/Xcode | Build/archive/test | ✗ (Linux host) | — | `macbuild`/`macos-26` CI runners only |
| GitHub Releases API (network) | Version verification | ✓ | — | — |

**Missing dependencies with no fallback:** none — every missing tool here is expected to be missing on a Linux research host and has a documented fallback (`macbuild`/CI), consistent with this milestone's own stated verification reality.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `swift test` (Swift Testing / XCTest, via SwiftPM) for `RawkoonKit` only — confirmed via `ios.yml`'s `kit` job and `Package.swift` |
| Config file | `apps/ios/Package.swift` |
| Quick run command | `cd apps/ios && swift test` (Linux-safe, `RawkoonKit`/`RawkoonKitTests` only) |
| Full suite command | Same — there is no app-target test bundle yet (that's Phase 5's TEST-01/TEST-02); this phase's logging/lint additions live entirely in the app target, which `swift test` cannot reach |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINT-01/02/03/04 | `.swiftlint.yml`/`.swiftformat` correctness, CI job gating | CI job run (not a unit test) | `swiftlint lint --config apps/ios/.swiftlint.yml apps/ios/Rawkoon` / `swiftformat --lint apps/ios` on `macbuild` | ❌ — configs don't exist yet, created this phase |
| LOG-01 | 5 categories exist | manual code inspection | `grep -c 'Logger(subsystem:' apps/ios/Rawkoon/Logging.swift` | ❌ — file doesn't exist yet |
| LOG-02 | 11 in-scope `try?` sites logged/commented | manual code inspection (no app-target test harness exists yet — see Phase 5) | `grep -rn 'try?' apps/ios/Rawkoon/AudiobookPlayer.swift apps/ios/Rawkoon/ChapterDownloader.swift apps/ios/Rawkoon/FileStore.swift` (manual read of context, not automatable to "logged or commented" without a human/LLM read) | N/A — inherently a code-review-style check, not a runnable test |
| LOG-03/04 | No credential leaks; docs page exists | manual verification on `macbuild` simulator + doc review | See Open Questions §4's concrete command sequence | ❌ — no automated test possible; this is a manual/device verification by this milestone's own design (`ios.yml` has no app-target test job until Phase 5) |

### Sampling Rate

- **Per task commit:** `cd apps/ios && swift test` (fast, Linux-safe, catches nothing about this phase's actual changes but keeps `RawkoonKit` green as a baseline)
- **Per wave merge:** full `macbuild` sequence (`swift test` + `xcodegen generate` + `xcodebuild build`) plus the manual `lint`/logging verification from Open Questions §4
- **Phase gate:** the roadmap's own "Definition of done" — Linux `kit` green, `macbuild` `xcodebuild build` green at the verified HEAD sha, TestFlight upload succeeds, no user-visible change

### Wave 0 Gaps

- [ ] `apps/ios/.swiftlint.yml` — doesn't exist, created this phase
- [ ] `apps/ios/.swiftformat` — doesn't exist, created this phase
- [ ] `apps/ios/Rawkoon/Logging.swift` (or equivalent) — doesn't exist, created this phase
- [ ] A macbuild run of SwiftLint with generous size-rule thresholds, to measure real `type_body_length`/`function_body_length` worst-cases before locking final thresholds (Open Questions §2) — this is a genuine Wave-0 prerequisite, not optional
- [ ] No app-target unit test framework exists yet (Phase 5); this phase's LOG-02/03/04 criteria are verified manually/on-device by design, not by an automated test the plan can write

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No (not touched this phase — login/token issuance is unchanged) | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | No (no new inputs; logging existing values) | — |
| V6 Cryptography | No | — |
| **V7 Error Handling and Logging** (ASVS 4.x's closest analogue, sometimes numbered differently across ASVS versions) | **Yes — this is the core of the phase** | Never log secrets/PII in cleartext; use `os.Logger`'s `privacy:` mechanism; this is exactly LOG-03 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Sensitive data exposure via logs (bearer token, signed download URL, password) | Information Disclosure | `os.Logger` `.private` default + explicit `.public` only on genuinely non-sensitive fields (integers, enums, statuses); never interpolate `Authorization` header values, `chapter.url` (a signed grant), or `password` parameters |
| Log-based debugging bypass (Xcode debugger disabling redaction) | Information Disclosure (via a different vector — the developer's own machine, not an attacker's) | Not an external-attacker threat per se, but a real internal risk: a screen-recorded or copy-pasted Xcode console session during development could leak a token that would otherwise be redacted on a real device/TestFlight build. Document this in the new `docs/` page (LOG-04) as a caution for future debugging sessions, not just a testing-methodology note |

## Sources

### Primary (HIGH confidence — verified by direct tool call this session)

- GitHub Releases API, `realm/SwiftLint` — version 0.65.1, published 2026-08-21
- GitHub Releases API, `nicklockwood/SwiftFormat` — version 0.63.0, published 2026-08-30
- GitHub Repos API, both repos — age, star count, archived status
- `raw.githubusercontent.com/realm/SwiftLint/main/Source/SwiftLintCore/RuleConfigurations/SeverityLevelsConfiguration.swift` — direct source read confirming warning-only config disables the error threshold
- This repository, read directly this session: `.github/workflows/ios.yml`, `apps/ios/project.yml`, `apps/ios/Package.swift`, `apps/ios/docs/code-quality-audit.md`, `apps/ios/Rawkoon/AudiobookPlayer.swift`, `apps/ios/Rawkoon/ChapterDownloader.swift`, `apps/ios/Rawkoon/FileStore.swift`, `apps/ios/Rawkoon/AppModel.swift`, `apps/ios/Rawkoon/APIClient.swift`, `apps/ios/Rawkoon/Views/DebugScreens.swift`, `apps/ios/Rawkoon/Views/ContinueListeningView.swift`, `apps/ios/Rawkoon/Views/BookView.swift`, `apps/ios/Sources/RawkoonKit/BookManifest.swift`, `apps/ios/Sources/RawkoonKit/SyncReconciler.swift`, plus a full `grep -rn 'try?'` inventory and `wc -l` line counts across the whole app target

### Secondary (MEDIUM confidence — WebSearch cross-checked against multiple independent sources)

- SwiftLint `--strict` semantics — cross-checked across GitHub issues #268, #3312, #834
- SwiftLint default thresholds for `file_length`/`type_body_length`/`function_body_length` — realm.github.io rule reference pages
- SwiftFormat `--lint` exit-code semantics — SwiftFormat's own GitHub docs, via WebSearch summary
- `os.Logger` privacy defaults (numeric public, string private) — Apple's `OSLogPrivacy` docs, cross-checked against SwiftLee
- `OS_ACTIVITY_DT_MODE`/Xcode-debugger redaction bypass — cross-checked across multiple independent Apple Developer Forums threads

### Tertiary (LOW confidence / carried forward, re-verified this session — not newly asserted)

- None — every claim in this document was either directly verified this session or explicitly flagged as an Open Question rather than asserted at low confidence.

## Metadata

**Confidence breakdown:**
- Standard stack (SwiftLint/SwiftFormat versions, install method): HIGH — verified via GitHub API directly, matches and confirms prior milestone research
- Architecture (CI job graph, file scoping, `try?` inventory): HIGH — every fact read directly from the repo this session, with file:line citations
- Pitfalls (`--strict` semantics, `OS_ACTIVITY_DT_MODE`): MEDIUM-HIGH — cross-checked across multiple independent sources, not a single canonical Apple statement, but consistent
- `type_body_length`/`function_body_length` exact thresholds: LOW/deferred — correctly flagged as needing a macbuild measurement rather than guessed

**Research date:** 2026-09-01
**Valid until:** 2026-10-01 (30 days) for the versioned tool recommendations (SwiftLint/SwiftFormat move fast — re-check versions before executing if this research is more than a few weeks old); the repo-fact findings (line counts, `try?` inventory, job graph) are valid until the next commit touches those files — re-verify at plan time if significant time has passed since 2026-09-01.
