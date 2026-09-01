<!-- GSD:project-start source:PROJECT.md -->

## Project

**Rawkoon iOS — clean-code pass**

Rawkoon's native iPhone companion app: a SwiftUI client for the self-hosted
Rawkoon server that discovers titles, manages the download queue, and plays
downloaded audiobooks and ebooks offline. It ships to TestFlight from GitHub
Actions and is at v1.12.6.

This milestone is not a feature milestone. It is a structural pass over
`apps/ios` that pays down the debt catalogued in
`apps/ios/docs/code-quality-audit.md` — no user-visible behavior changes, no new
screens — so that the next feature is cheap to build and the next bug is
possible to diagnose.

**Core Value:** The app keeps shipping. Every phase ends with a build that installs from
TestFlight and behaves exactly as the one before it — a refactor the user can
feel is a failed refactor.

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
- **Behavior**: no user-visible change, including layout and wording, until the
  localization phase (which changes the mechanism, not the English strings)
- **Tech stack**: SwiftUI, iOS 18 deployment target, Xcode 26 SDK, XcodeGen,
  Readium 3.11.0 pinned, no new third-party dependencies except the lint and
  format toolchain
- **Build settings**: edited in `project.yml`, never in a generated `.xcodeproj`
- **Ordering**: guardrails (lint, logging) before the large refactors, so the
  linter and the compiler hold the new boundaries rather than review alone
- **Compatibility**: no migration of on-device state — the position journal, the
  Keychain entries, and the downloaded library must survive an app update
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## 1. SwiftLint + SwiftFormat

### Versions (confidence: HIGH — checked GitHub releases API directly)

| Tool | Latest | Published | Notes |
|---|---|---|---|
| SwiftLint | **0.65.1** | 2026-08-21 | `realm/SwiftLint`. Homebrew formula (`formulae.brew.sh/formula/swiftlint`) tracks this. |
| SwiftFormat | **0.63.0** | 2026-08-30 | `nicklockwood/SwiftFormat`. Two days old as of this research — if it looks unstable, `0.62.1` (2026-07-07) is the fallback. |

### Install method: brew, not Mint, not the SPM plugin

- The `ios.yml` `build` and `testflight` jobs already do `brew install xcodegen` on `macos-26` with no version pin — this project's convention is "trust brew's current formula," not vendor a version. Match that pattern rather than introducing Mint (a new tool dependency) or a hand-pinned binary download for a project this size.
- Cost: `brew install swiftlint swiftformat` adds roughly 20-40s to the `lint` job on a `macos-26` runner (Homebrew casks/formulae for these are small, no build-from-source). This is materially cheaper than an SPM build-tool plugin, which recompiles SwiftLint's own dependency graph on every clean checkout unless cached (see below).
- If a reproducible pin becomes important later, `brew install swiftlint@0.65.1` works if that versioned formula exists, otherwise pin via a specific formula commit URL or switch to Mint (`mint run realm/swiftlint@0.65.1`). Not needed for this milestone — don't add the complexity preemptively.

# .github/workflows/ios.yml — new job, can run in parallel with `kit`

### How they coexist without fighting

### `.swiftlint.yml` for a 13k-line codebase adopting late

### Sources

- [SwiftLint releases (GitHub API)](https://api.github.com/repos/realm/SwiftLint/releases) — version/date ground truth
- [SwiftFormat releases (GitHub API)](https://api.github.com/repos/nicklockwood/SwiftFormat/releases) — version/date ground truth
- [SwiftLint issue #6574 — swift-syntax prerelease blocks Xcode 26 prebuilt cache](https://github.com/realm/SwiftLint/issues/6574)
- [SwiftLint issue #5822 — warning-only length rule config, resolved as user config error, not a defect](https://github.com/realm/SwiftLint/issues/5822)
- [SwiftLint `file_length` rule reference](https://realm.github.io/SwiftLint/file_length.html)
- [SwiftLee — valuable SwiftLint opt-in rules](https://www.avanderlee.com/optimization/swiftlint-optin-rules/)
- [Homebrew formula: swiftlint](https://formulae.brew.sh/formula/swiftlint)
- [Modernizing existing iOS projects: adopting SwiftLint and SwiftFormat](https://ahmadbrkt.medium.com/modernizing-existing-ios-projects-a-strategy-for-adopting-swiftlint-and-swiftformat-11030b668310) (also cited in the audit itself)

## 2. String Catalogs (`.xcstrings`)

### Auto-extraction in Xcode 26: what actually triggers it (confidence: HIGH for the mechanism, MEDIUM for exact Xcode-26-specific UI details — WWDC session content, not a static doc)

- `Text("literal")` — picked up automatically, no code change required. This covers the bulk of the 106 sites the audit found.
- `Text("Downloaded \(count) episodes")` (string interpolation) — extraction differs by *type* of the interpolated value. Interpolating a `String` inside a `Text(...)` literal is recognized as localizable and generates a format-string key with `%@`; interpolating other types (`Int`, `Double`, pre-formatted numbers via `String(format:)`) either fails to localize the segment correctly or produces confusing catalog entries (a documented, reproducible pitfall — see below). Where the audit's `formatBytes`/`formatDuration`/`formatSpeed` output ends up inside a `Text`, verify each such call site by hand after extraction; don't assume interpolation "just works."
- Strings that are *not* literal `Text` arguments — e.g. built as a `String` variable and passed to `Text(myString)` — are **not** extracted, because `Text(_:)` has an overload for plain `String` that means "already localized/don't touch," which is exactly `Text(verbatim:)` semantics. Any of the 106 sites that build a string via concatenation/interpolation into a local `let` before handing it to `Text` need to be rewritten to either pass the literal directly to `Text` or wrap with `String(localized:)` explicitly — this is the one place hardcoded-literal migration is not "just add a catalog and rebuild."
- SwiftUI modifiers that take a `LocalizedStringKey` (`.navigationTitle("...")`, `.accessibilityLabel("...")`, `Button("...")`, alert titles/messages) behave the same as `Text` — literal string arguments are auto-extracted, since `LocalizedStringKey` is an `ExpressibleByStringLiteral` type that signals "this is a key, not raw data," same mechanism as `Text`.

### Migration mechanics for ~106 sites

### Adding `fr` (confidence: HIGH for mechanism; MEDIUM for the exact `knownRegions` interaction, verified via XcodeGen's own PR diff rather than an official Apple doc)

### Sources

- [Xcode String Catalog (.xcstrings): the complete guide](https://simplelocalize.io/blog/posts/xcstrings-string-catalog-guide/)
- [WWDC25 — Explore localization with Xcode (code-along)](https://developer.apple.com/videos/play/wwdc2025/225/)
- [String interpolation in LocalizedStringKey — nilcoalescing.com](https://nilcoalescing.com/blog/StringInterpolationInLocalizedStringKey/)
- [XcodeGen PR #1421 — String Catalogs support, incl. knownRegions locale merge from `.xcstrings`](https://github.com/yonaskolb/XcodeGen/pull/1421)
- [XcodeGen CHANGELOG — `.xcstrings` support landed in 2.39.0](https://github.com/yonaskolb/XcodeGen/blob/master/CHANGELOG.md)
- [XcodeGen issue #436 — knownRegions/developmentRegion interaction (general, pre-xcstrings)](https://github.com/yonaskolb/XcodeGen/issues/436)

## 3. `xcodebuild test` for the app target in CI

### Test plans + XcodeGen wiring (confidence: HIGH for XcodeGen mechanics — official `ProjectSpec.md`; MEDIUM for exact `.xctestplan` authoring workflow, which is inherently GUI-driven)

# project.yml additions

### Does a SwiftUI app's unit-test target need a host application?

### Destination string and simulator selection (confidence: HIGH for the build job's existing pattern in `ios.yml`, MEDIUM for the dynamic-selection mechanism specifics — behavior varies release-to-release)

- name: Select a simulator destination
- name: Run app-target tests

### Swift Testing vs XCTest (confidence: MEDIUM — consistent across many 2025/2026 sources, but no single canonical Apple statement found for "which to use in 2026" beyond WWDC24's introduction)

### Sources

- [XcodeGen `ProjectSpec.md` — testTargets, testPlans, TEST_HOST](https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md)
- [Apple Developer Forums — XCTest, adding source files to test target vs Host Application](https://developer.apple.com/forums/thread/734168)
- [Run Tests Without an App — Step by Step with Xcode (Host Application: None)](https://xp123.com/run-tests-without-an-app-step-by-step-with-xcode/)
- [`actions/runner-images` issue #12948 — simulators intermittently missing on macOS runner](https://github.com/actions/runner-images/issues/12948)
- [Apple — Meet Swift Testing, WWDC24](https://developer.apple.com/videos/play/wwdc2024/10179/)
- [Migrating XCTest to Swift Testing — useyourloaf.com](https://useyourloaf.com/blog/migrating-xctest-to-swift-testing/)

## 4. `os.Logger`

### Subsystem/category structure (confidence: HIGH — stable Apple API since iOS 14, unchanged fundamentals)

### Privacy annotations and default redaction (confidence: HIGH)

### Retrieval — the practical story (confidence: HIGH for commands, MEDIUM for exact device-side UX specifics which can shift release to release)

### Sources

- [SwiftLee — OSLog and Unified Logging as recommended by Apple](https://www.avanderlee.com/debugging/oslog-unified-logging/)
- [Logging Privacy Shenanigans — steipete.me](https://steipete.me/posts/2025/logging-privacy-shenanigans)
- [Apple — Explore logging in Swift, WWDC20](https://developer.apple.com/videos/play/wwdc2020/10168/)
- [`log` man page device options (`--device-udid`, `collect`)](http://www.mac4n6.com/blog/2020/9/8/analysis-of-apple-unified-logs-entry-12-quick-amp-easy-unified-log-collection-from-ios-devices-for-testing)
- [simctl log stream/show usage — xcblog](https://medium.com/xcblog/simctl-control-ios-simulators-from-command-line-78b9006a20dc)

## What NOT to use, summarized

| Considered | Verdict | Why not |
|---|---|---|
| Mint for SwiftLint/SwiftFormat | Skip | Adds a tool dependency the rest of `ios.yml` doesn't have; brew already matches the `xcodegen` install pattern in the same file |
| SwiftLint SPM build-tool plugin | Skip | Slows every local Xcode build, not just CI; SwiftLint's prerelease `swift-syntax` pin currently defeats Xcode 26's prebuilt-cache optimization on every clean build |
| `swiftlint --fix` / `--autocorrect` in CI | Skip | Two autocorrecting tools (SwiftFormat + SwiftLint) touching the same files risks fight-loops; make SwiftFormat the sole autocorrect authority, SwiftLint report-only |
| `.strings`/`.lproj`-based localization | Skip | `.xcstrings` is the current mechanism (project has zero existing `.strings` files, so there's no migration cost either way — greenfield choice, and `.xcstrings` is strictly better for this) |
| Hardcoded simulator device name in `-destination` | Skip | Not guaranteed to exist on a given `macos-26` runner image; query `simctl list devices available` and pick dynamically instead |
| Unit-test target with a Host Application | Skip (for now) | Not needed for the view-model logic tests TEST-01/VM-01 actually require; adds app-launch overhead per test run for no benefit at this milestone's scope |
| XCTest for new tests | Skip (for new code) | Swift Testing is Apple's current default for new unit/integration tests; XCTest only stays relevant for UI automation/performance tests, neither in scope here |
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| deploying-rawkoon | Use when deploying, releasing, shipping, or rolling back rawkoon — bumping the version, cutting the GitHub release that publishes the ghcr.io Docker image, diagnosing a failed "Build and Push Docker Image" run, or recovering a production instance stuck on a bad image tag. | `.claude/skills/deploying-rawkoon/SKILL.md` |
| writing-rawkoon-release-notes | Use when writing or rewriting the description of a rawkoon GitHub release — right after `gh release create`, when auto-generated notes need replacing, or when backfilling several releases at once. Covers the required title format, the section order, and what counts as a highlight. | `.claude/skills/writing-rawkoon-release-notes/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
