# Technology Stack — iOS Code-Quality Milestone

**Project:** Rawkoon iOS (`apps/ios`) — clean-code pass, no feature work
**Researched:** 2026-09-01
**Scope:** Tooling only, for the four items in the research question (lint/format, string catalogs, `xcodebuild test`, `os.Logger`). Does not cover SwiftUI/MVVM/Swift 6 concurrency — other researchers own those.

Versions below were checked against each tool's own GitHub Releases API (`api.github.com/repos/...`) on 2026-09-01, not training data. Where a claim rests on community consensus rather than an official doc, it's marked MEDIUM confidence explicitly.

---

## 1. SwiftLint + SwiftFormat

### Versions (confidence: HIGH — checked GitHub releases API directly)

| Tool | Latest | Published | Notes |
|---|---|---|---|
| SwiftLint | **0.65.1** | 2026-08-21 | `realm/SwiftLint`. Homebrew formula (`formulae.brew.sh/formula/swiftlint`) tracks this. |
| SwiftFormat | **0.63.0** | 2026-08-30 | `nicklockwood/SwiftFormat`. Two days old as of this research — if it looks unstable, `0.62.1` (2026-07-07) is the fallback. |

### Install method: brew, not Mint, not the SPM plugin

**Recommendation: `brew install swiftlint swiftformat` in the CI job, no pin.**

- The `ios.yml` `build` and `testflight` jobs already do `brew install xcodegen` on `macos-26` with no version pin — this project's convention is "trust brew's current formula," not vendor a version. Match that pattern rather than introducing Mint (a new tool dependency) or a hand-pinned binary download for a project this size.
- Cost: `brew install swiftlint swiftformat` adds roughly 20-40s to the `lint` job on a `macos-26` runner (Homebrew casks/formulae for these are small, no build-from-source). This is materially cheaper than an SPM build-tool plugin, which recompiles SwiftLint's own dependency graph on every clean checkout unless cached (see below).
- If a reproducible pin becomes important later, `brew install swiftlint@0.65.1` works if that versioned formula exists, otherwise pin via a specific formula commit URL or switch to Mint (`mint run realm/swiftlint@0.65.1`). Not needed for this milestone — don't add the complexity preemptively.

**Do not use the SwiftLint SPM build-tool plugin for this project.** Two independent reasons, both specific to this repo:

1. **`.xcodeproj` is generated, not committed.** The SPM build-tool-plugin approach (`.package(url: "https://github.com/realm/SwiftLint", ...)` + `plugin("SwiftLintPlugin")` on the target) requires either (a) adding SwiftLint as a dependency in `Package.swift`/`project.yml`'s `packages:` block and attaching the plugin to the `Rawkoon` target in `project.yml`, which XcodeGen does support (`buildToolPlugins:` under a target) — but this makes SwiftLint a build-time dependency of the app target, which:
   - Runs on every Xcode build a developer does locally, not just CI — slower inner-loop builds on the linter, which is the opposite of what a "guardrail before the big refactor" phase wants.
   - As of the currently-open SwiftLint issue on `swift-syntax` versioning, SwiftLint depends on a **prerelease** `swift-syntax` (`604.0.0-prerelease-2026-03-31` as of the version investigated), which means Xcode **cannot use its Xcode-26 prebuilt swift-syntax cache** and must compile swift-syntax from source on every clean build — this is a real, currently-open cost, not a hypothetical one.
2. **A build-phase script (the alternative embedding approach) requires declaring it in `project.yml`** as a `prebuildScripts`/`postbuildScripts` entry on the `Rawkoon` target — mechanically fine, but this still runs on every local build.

**Verdict: CI-only invocation.** Add a `lint` job to `ios.yml` that runs `swiftlint lint --strict` and `swiftformat --lint .` directly against the checked-out source (`apps/ios/Rawkoon`, `apps/ios/Sources`), independent of `xcodegen generate`/`xcodebuild`. This is the cheapest, fastest, and least invasive option, and it keeps local Xcode builds exactly as fast as they are today — consistent with the milestone's "must archive and upload to TestFlight after every phase" and "no phase leaves `main` unshippable" constraints, since a broken lint tool can never break the build.

```yaml
# .github/workflows/ios.yml — new job, can run in parallel with `kit`
lint:
  runs-on: macos-26
  steps:
    - uses: actions/checkout@v4
    - run: brew install swiftlint swiftformat
    - name: SwiftFormat (lint mode)
      working-directory: apps/ios
      run: swiftformat --lint Rawkoon Sources Tests
    - name: SwiftLint
      working-directory: apps/ios
      run: swiftlint lint --strict --config .swiftlint.yml Rawkoon
```

Note this runs on `macos-26`, not `ubuntu-latest`. SwiftLint and SwiftFormat both publish Linux binaries in principle, but the project's own `kit` job proves Linux CI is reserved for `RawkoonKit` (pure Swift, no UIKit/SwiftUI/platform imports); the app target's views import `SwiftUI`/`os`/etc. Since SwiftLint just parses source text (it doesn't compile), it *could* run on `ubuntu-latest` against `Rawkoon/` too — but doing so would introduce a second Swift toolchain download (SwiftLint's Linux binary needs a matching Swift runtime) for a job that's already fast on `macos-26`. Given the project has `macos-26` runners provisioned and budgeted for `build`/`testflight` already, keep `lint` there for consistency; this is a minor optimization opportunity, not a correctness issue, if CI minutes become a concern later.

### How they coexist without fighting

Both tools reformat/flag *style*, and where their opinions diverge on the same construct they will loop forever (SwiftFormat rewrites it one way, SwiftLint's autocorrect rewrites it back). The community-standard split (MEDIUM confidence — no single official "use both" doc from either maintainer, but this division is consistent across essentially every writeup found, including the audit's own cited source) is:

**Let SwiftFormat own whitespace/token-level formatting; let SwiftLint own everything SwiftFormat doesn't touch (complexity, naming, dead code, correctness-adjacent style).**

Disable in `.swiftlint.yml` the rules that duplicate SwiftFormat's job — they're formatting rules SwiftLint would otherwise also flag/autocorrect, and running both risks conflicting autocorrect output:

```yaml
disabled_rules:
  - trailing_whitespace
  - vertical_whitespace
  - colon
  - comma
  - comma_inheritance
  - opening_brace
  - statement_position
  - closure_spacing
  - trailing_comma
  - redundant_void_return
  - void_return
```

Never run `swiftlint --fix`/`swiftlint --autocorrect` in CI or as a habit alongside `swiftformat` on the same files — pick one tool as the autocorrect authority (SwiftFormat) and let SwiftLint be lint-only (`--strict`, no autocorrect) in this project. This also matches "no user-visible behavior change" safety: a lint job that only reports, never rewrites, can't accidentally alter code as a side effect of CI.

### `.swiftlint.yml` for a 13k-line codebase adopting late

Two concrete decisions, both load-bearing for a *late* adoption (i.e., don't want the first CI run to be 4,000 violations):

**1. Length rules as warning-only, no error threshold.** This is directly relevant to this milestone: `MediaDetailView` is 1,443 lines / `BookView` is 1,227 — both already blow past SwiftLint's *default error* thresholds (`file_length` error default is 1000 lines; `type_body_length` error default is 350 lines). If `.swiftlint.yml` ships with defaults, `swiftlint lint --strict` **fails the CI job on day one**, before any refactor phase has touched those files — which breaks the "must archive after every phase" constraint if `lint` gates merges. The mechanism is `warning: N` with no `error:` key:

```yaml
file_length:
  warning: 700
  ignore_comment_only_lines: true

type_body_length:
  warning: 350

function_body_length:
  warning: 80
```

Setting only `warning:` (omitting `error:`) is genuinely warning-only — confirmed against SwiftLint's own maintainer (`SimplyDanny`, a listed collaborator) in a still-open community issue about this exact confusion (realm/SwiftLint#5822): a user reported `warning:`-only config falling back to error-level behavior, but the maintainer's own repro showed `type_body_length: { warning: 40 }` alone working exactly as documented, and the reporter's actual bug was an unrelated stale/duplicate `.swiftlint.yml` being picked up from a subfolder — not a SwiftLint defect. Set the initial warning thresholds *above* the current worst offenders (e.g., `file_length: warning: 1500` if `MediaDetailView`'s exact line count needs headroom) if you want lint to pass clean on day one and ratchet the threshold down phase-by-phase as the view-model extraction (item 8 in the audit) lands — this is the mechanical way to make the linter "hold the boundary" per the milestone's stated ordering rationale, without it blocking the phases before the boundary exists.

`swiftlint lint --strict` treats *warnings* as failures too (`--strict` promotes warnings to a non-zero exit code), so if the intent is "warn but don't fail CI yet" during the early guardrail phase, drop `--strict` initially and add it once the codebase is under threshold, or scope `--strict` to `error`-severity rules only by not using `--strict` and instead checking `swiftlint lint`'s own exit code (which is non-zero only on `error`-severity violations, not `warning`). Given LINT-01 explicitly says "enforced by a CI job," the recommended sequencing is: land `.swiftlint.yml` + CI job **without** `--strict` in the phase that introduces linting (so it reports but doesn't block), then add `--strict` in a later phase once warning counts are near zero — this is a roadmap-level sequencing decision, not just a config one.

**2. `opt_in_rules` worth turning on for this specific codebase**, based on what the audit already found (23 `catch` blocks and 56 discarding `try?` in `MediaDetailView`/`BookView`, three raw `URLSession.shared` call sites, `ObservableObject`/`@Published` migration pending, duplicated formatters):

```yaml
opt_in_rules:
  - empty_count
  - empty_string
  - fatal_error_message
  - first_where
  - unused_private_declaration
  - unused_import
  - toggle_bool
  - modifier_order
  - identical_operands
  - closure_end_indentation      # if not delegated to SwiftFormat — verify no overlap first
  - discouraged_object_literal
  - force_unwrapping               # audit found zero force-unwraps; this rule is a regression guard, not a fixer
  - implicitly_unwrapped_optional
  - private_outlet
  - redundant_type_annotation
  - unneeded_parentheses_in_closure_argument
```

`force_unwrapping` and `implicitly_unwrapped_optional` are specifically valuable here *because* the audit found zero force-unwraps/`try!`/`as!` today — as opt-in rules they cost nothing (no existing violations) and prevent regression, which is exactly the "guardrails before the big refactor" framing in `PROJECT.md`. Do not enable `unused_declaration`/analyzer rules yet — those require `swiftlint analyze` with a full compiler invocation (a `.xcodebuild.log` or compilation database), which is a heavier CI step than this phase needs; defer to a later phase if wanted.

### Sources

- [SwiftLint releases (GitHub API)](https://api.github.com/repos/realm/SwiftLint/releases) — version/date ground truth
- [SwiftFormat releases (GitHub API)](https://api.github.com/repos/nicklockwood/SwiftFormat/releases) — version/date ground truth
- [SwiftLint issue #6574 — swift-syntax prerelease blocks Xcode 26 prebuilt cache](https://github.com/realm/SwiftLint/issues/6574)
- [SwiftLint issue #5822 — warning-only length rule config, resolved as user config error, not a defect](https://github.com/realm/SwiftLint/issues/5822)
- [SwiftLint `file_length` rule reference](https://realm.github.io/SwiftLint/file_length.html)
- [SwiftLee — valuable SwiftLint opt-in rules](https://www.avanderlee.com/optimization/swiftlint-optin-rules/)
- [Homebrew formula: swiftlint](https://formulae.brew.sh/formula/swiftlint)
- [Modernizing existing iOS projects: adopting SwiftLint and SwiftFormat](https://ahmadbrkt.medium.com/modernizing-existing-ios-projects-a-strategy-for-adopting-swiftlint-and-swiftformat-11030b668310) (also cited in the audit itself)

---

## 2. String Catalogs (`.xcstrings`)

### Auto-extraction in Xcode 26: what actually triggers it (confidence: HIGH for the mechanism, MEDIUM for exact Xcode-26-specific UI details — WWDC session content, not a static doc)

Xcode extracts localizable strings **after a build**, once a `.xcstrings` catalog exists in the project and is a member of the target. The trigger is: the catalog file is present and added as a resource on the `Rawkoon` target, then any build (not just Product > Build For > Testing) scans `Text("...")` literals, `String(localized:)` calls, and other Apple localization APIs and adds new keys to the catalog automatically. No source-code annotation is required to *get into* the catalog — a plain `Text("Continue Listening")` is picked up as-is.

**What has to change in source, and what doesn't:**
- `Text("literal")` — picked up automatically, no code change required. This covers the bulk of the 106 sites the audit found.
- `Text("Downloaded \(count) episodes")` (string interpolation) — extraction differs by *type* of the interpolated value. Interpolating a `String` inside a `Text(...)` literal is recognized as localizable and generates a format-string key with `%@`; interpolating other types (`Int`, `Double`, pre-formatted numbers via `String(format:)`) either fails to localize the segment correctly or produces confusing catalog entries (a documented, reproducible pitfall — see below). Where the audit's `formatBytes`/`formatDuration`/`formatSpeed` output ends up inside a `Text`, verify each such call site by hand after extraction; don't assume interpolation "just works."
- Strings that are *not* literal `Text` arguments — e.g. built as a `String` variable and passed to `Text(myString)` — are **not** extracted, because `Text(_:)` has an overload for plain `String` that means "already localized/don't touch," which is exactly `Text(verbatim:)` semantics. Any of the 106 sites that build a string via concatenation/interpolation into a local `let` before handing it to `Text` need to be rewritten to either pass the literal directly to `Text` or wrap with `String(localized:)` explicitly — this is the one place hardcoded-literal migration is not "just add a catalog and rebuild."
- SwiftUI modifiers that take a `LocalizedStringKey` (`.navigationTitle("...")`, `.accessibilityLabel("...")`, `Button("...")`, alert titles/messages) behave the same as `Text` — literal string arguments are auto-extracted, since `LocalizedStringKey` is an `ExpressibleByStringLiteral` type that signals "this is a key, not raw data," same mechanism as `Text`.

**Known traps (confidence: HIGH — multiple independent sources converge on identical failure modes):**
1. `String(interpolation)` saved to an untyped `let`/`var` before being handed to a localized API infers `String`, not `LocalizedStringKey` — losing localization silently (it compiles, looks right in English, and is simply never translated). If any of the 106 sites do `let title = "Playing \(book.title)"` then `Text(title)`, that call site will **not** extract and will **not** localize even after the catalog exists, with no compiler warning. This needs a manual audit pass, not a mechanical find-replace.
2. Passing a pre-formatted number/string through interpolation (e.g. `Text("\(String(format: "%.1f", progress))% complete")`) produces a catalog key containing literal `%@` or `%%` noise that's confusing for a translator and easy to get wrong when adding `fr` — prefer `Text("\(progress, specifier: "%.1f")% complete")` (SwiftUI's own formatted-interpolation, which *does* extract cleanly) over pre-formatting into a `String` first.
3. `Text(verbatim:)` deliberately opts a string **out** of localization/extraction — useful for genuinely non-user-facing text (log-adjacent debug labels, raw identifiers shown in a debug screen) but a footgun if used out of habit on real UI text.

### Migration mechanics for ~106 sites

Xcode's built-in migration path (Editor menu / right-click on a `Localizable.strings` file → "Migrate to String Catalog") is for projects that **already have** `.strings` files — this app has none, so that command doesn't apply. The actual path here:

1. Add an empty `Localizable.xcstrings` file to the `Rawkoon/` source tree (`File > New > File > String Catalog` in Xcode, or hand-author the minimal JSON — the format is a plain JSON document with `sourceLanguage` and a `strings` dict, simple enough to create by hand if scripting the addition).
2. Add it as a resource in `project.yml` — XcodeGen (≥2.39.0, which added `.xcstrings` support in PR #1421) auto-registers `.xcstrings` as a `resources` build-phase file type by extension, same bucket as `.xcassets`. It just needs to be inside a path already covered by the target's `sources:` list (`sources: [Rawkoon]` already covers `Rawkoon/Localizable.xcstrings` if it's placed there — no separate `resources:` entry needed unless it's placed outside that tree).
3. Build once. Xcode extracts every `Text("literal")`/`LocalizedStringKey`-typed literal it finds under the compiled target into the catalog automatically, keyed by the literal string itself.
4. Manually resolve the traps above (interpolated-`String`-before-`Text` sites) — these will silently *not* appear in the catalog after step 3, so the check is "grep for `Text(someVariable)` where `someVariable` isn't itself a `LocalizedStringKey`-typed constant," not "count catalog entries against 106."

### Adding `fr` (confidence: HIGH for mechanism; MEDIUM for the exact `knownRegions` interaction, verified via XcodeGen's own PR diff rather than an official Apple doc)

In Xcode: Project settings → Info → Localizations → "+" → French. This adds an entry inside the `.xcstrings` file's internal per-string language table (no `fr.lproj` folder is created — that's the whole point of the catalog format superseding `.strings`+`.lproj`) **and** adds `fr` to the `.xcodeproj`'s `knownRegions` (a project-level pbxproj setting, separate from any build setting, that App Store Connect/the OS use to know which languages the app declares support for).

This matters for the XcodeGen-generated-project constraint specifically: **XcodeGen's default behavior derives `knownRegions` from `*.lproj` folder names on disk** — which won't exist here, since there are no `.lproj` folders in a String-Catalog-only project. This *could* have been a real trap (regenerate the project and lose the `fr` region declaration on the next `xcodegen generate`). It isn't, verified directly against XcodeGen's PR #1421 diff: current XcodeGen (≥2.39.0; CI's unpinned `brew install xcodegen` will get something well past this) **parses the `.xcstrings` JSON itself and merges the locales it finds inside the catalog into `knownRegions`**, independent of `.lproj` folders. Practically: once a translator (or you) adds an `fr` value to even one string inside `Localizable.xcstrings`, the next `xcodegen generate` in CI will correctly regenerate `knownRegions` with `fr` included — no manual `project.yml` edit required. Nothing else needs to change in `project.yml` for this.

### Sources

- [Xcode String Catalog (.xcstrings): the complete guide](https://simplelocalize.io/blog/posts/xcstrings-string-catalog-guide/)
- [WWDC25 — Explore localization with Xcode (code-along)](https://developer.apple.com/videos/play/wwdc2025/225/)
- [String interpolation in LocalizedStringKey — nilcoalescing.com](https://nilcoalescing.com/blog/StringInterpolationInLocalizedStringKey/)
- [XcodeGen PR #1421 — String Catalogs support, incl. knownRegions locale merge from `.xcstrings`](https://github.com/yonaskolb/XcodeGen/pull/1421)
- [XcodeGen CHANGELOG — `.xcstrings` support landed in 2.39.0](https://github.com/yonaskolb/XcodeGen/blob/master/CHANGELOG.md)
- [XcodeGen issue #436 — knownRegions/developmentRegion interaction (general, pre-xcstrings)](https://github.com/yonaskolb/XcodeGen/issues/436)

---

## 3. `xcodebuild test` for the app target in CI

### Test plans + XcodeGen wiring (confidence: HIGH for XcodeGen mechanics — official `ProjectSpec.md`; MEDIUM for exact `.xctestplan` authoring workflow, which is inherently GUI-driven)

`.xctestplan` files are **not generated by XcodeGen** — they're authored in Xcode (Product > Test Plan > New Test Plan, or converting the default scheme-based test config into an explicit plan) and then committed to the repo like any other source file (they're plain JSON), and referenced by path from `project.yml`. This is one of the few artifacts in this project that must be hand-authored in Xcode and checked in, unlike everything else which is regenerated — worth calling out explicitly since the milestone's ethos is "`project.yml` is the source of truth, never edit the generated project," and a `.xctestplan` is an exception to "never commit generated Xcode artifacts" (it's not generated *by* XcodeGen, it's an input to it, same category as `project.yml` itself).

```yaml
# project.yml additions
targets:
  Rawkoon:
    # ...existing config unchanged...

  RawkoonTests:
    type: bundle.unit-test
    platform: iOS
    sources: [RawkoonTests]
    dependencies:
      - target: Rawkoon

schemes:
  Rawkoon:
    build:
      targets:
        Rawkoon: all
        RawkoonTests: [test]
    test:
      testPlans:
        - path: Rawkoon.xctestplan
          defaultPlan: true
```

(Exact top-level `schemes:` vs. inline `target.scheme:` placement depends on whether a custom scheme already exists for `Rawkoon` in `project.yml` — none is defined today, so XcodeGen is auto-generating a default scheme; introducing an explicit `schemes:` block or a `target.scheme.testTargets`/`testPlans` entry is required either way to attach a test plan and a test target.)

### Does a SwiftUI app's unit-test target need a host application?

**No — not for testing pure logic/view-model code via `@testable import`, and this is the right choice for VM-01's eventual `@Observable` view models.** Since Xcode 11.4 (2020), a Unit Testing Bundle target can set **Host Application: None**. With no host, the test bundle runs standalone (faster — no app launch overhead) and `@testable import Rawkoon` still works as long as the test target has the app target added as a **dependency** (XcodeGen's `dependencies: [{ target: Rawkoon }]`, as above) with `ENABLE_TESTABILITY = YES` on the app target (Xcode's default for Debug configs). A host application is only required when the tests need the *running app's* environment — its `Info.plist`, its bundle resources, Objective-C runtime features tied to the app's actual process, or (relevant here specifically) anything that depends on `UIApplication`/scene lifecycle, `AVAudioSession` category ownership, or `MPRemoteCommandCenter` — none of which apply to testing extracted view-model logic. Given TEST-01 is explicitly scoped to running *against* the app target (not full app-lifecycle integration tests), start with `Host Application: None` — it's simpler, faster, and matches this milestone's actual near-term need (unit tests for extracted logic, not UI automation). If a later phase needs to test something that genuinely requires the running app (e.g. background audio session behavior), that's a different, heavier test target — don't conflate the two.

### Destination string and simulator selection (confidence: HIGH for the build job's existing pattern in `ios.yml`, MEDIUM for the dynamic-selection mechanism specifics — behavior varies release-to-release)

The existing `build` job already uses `-destination 'generic/platform=iOS Simulator'` — but that only works for `xcodebuild build` (compiling for the simulator architecture, no run needed). `xcodebuild test` **requires an actual booted-or-bootable simulator**, not the generic platform destination — `generic/platform=iOS Simulator` will fail for `-testing`/`test` actions with "Unable to find a destination."

Do not hardcode a device name like `'platform=iOS Simulator,name=iPhone 16,OS=18.0'` — `macos-26` runner images ship whatever simulators came with the selected Xcode 26 install, and specific device/OS combinations are not guaranteed stable across runner-image updates (there's an open, acknowledged `actions/runner-images` issue about simulators intermittently missing entirely on a given run, independent of device-name choice — a transient CI infra issue, not something a smarter destination string avoids). The robust pattern: query what's actually available on the runner and pick the first match, rather than asserting a specific model exists.

```yaml
- name: Select a simulator destination
  id: sim
  working-directory: apps/ios
  run: |
    UDID=$(xcrun simctl list devices available iOS -j \
      | python3 -c '
import json, sys
data = json.load(sys.stdin)["devices"]
for runtime, devices in sorted(data.items(), reverse=True):
    for d in devices:
        if d.get("isAvailable") and "iPhone" in d["name"]:
            print(d["udid"]); sys.exit(0)
sys.exit(1)
')
    echo "udid=$UDID" >> "$GITHUB_OUTPUT"

- name: Run app-target tests
  working-directory: apps/ios
  run: |
    xcodebuild test \
      -project Rawkoon.xcodeproj -scheme Rawkoon \
      -destination "id=${{ steps.sim.outputs.udid }}" \
      CODE_SIGNING_ALLOWED=NO
```

`sorted(..., reverse=True)` biases toward the newest installed iOS runtime, which is the right default (deployment target is iOS 18, and `macos-26`/Xcode 26 will have iOS 26 as the primary bundled runtime — testing on the newest available runtime that's still ≥ the 18.0 deployment target is standard practice). This avoids ever writing "iPhone 16" or "iOS 18.2" into CI config, which is exactly what the audit / PROJECT.md's "no phase leaves main unshippable" constraint wants — a hardcoded device name is a CI outage waiting for the next runner-image bump.

### Swift Testing vs XCTest (confidence: MEDIUM — consistent across many 2025/2026 sources, but no single canonical Apple statement found for "which to use in 2026" beyond WWDC24's introduction)

Write new tests in **Swift Testing** (`import Testing`, `@Test`, `#expect`). It's Apple's forward path since Xcode 16/Swift 6, integrates with `xcodebuild test` and `swift test` identically to XCTest (same `-destination`/test-plan mechanics — nothing in the CI wiring above changes based on which framework a test file uses), and is the framework Apple is investing new features into. **Both can coexist in one test target** — this is explicitly supported and common; a target can contain files using `import XCTest` (`XCTestCase` subclasses) alongside files using `import Testing` (`@Test` functions), and `xcodebuild test` runs and reports both. Practical guidance for this milestone: since `RawkoonTests` is a brand-new target with zero existing tests, there's no migration to do — write every test in Swift Testing from day one, and only reach for XCTest if something specifically needs an XCTest-only feature (UI automation via `XCUIApplication`, or `XCTMetric`-based performance tests) — neither of which applies to VM-01's view-model unit tests.

### Sources

- [XcodeGen `ProjectSpec.md` — testTargets, testPlans, TEST_HOST](https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md)
- [Apple Developer Forums — XCTest, adding source files to test target vs Host Application](https://developer.apple.com/forums/thread/734168)
- [Run Tests Without an App — Step by Step with Xcode (Host Application: None)](https://xp123.com/run-tests-without-an-app-step-by-step-with-xcode/)
- [`actions/runner-images` issue #12948 — simulators intermittently missing on macOS runner](https://github.com/actions/runner-images/issues/12948)
- [Apple — Meet Swift Testing, WWDC24](https://developer.apple.com/videos/play/wwdc2024/10179/)
- [Migrating XCTest to Swift Testing — useyourloaf.com](https://useyourloaf.com/blog/migrating-xctest-to-swift-testing/)

---

## 4. `os.Logger`

### Subsystem/category structure (confidence: HIGH — stable Apple API since iOS 14, unchanged fundamentals)

One `Logger` instance per domain, matching how the audit already frames LOG-01 ("a single `Logger(subsystem:..., category:...)` per domain"). Concretely for this app:

```swift
import os

extension Logger {
    private static let subsystem = "cloud.samlo.rawkoon"

    static let playback = Logger(subsystem: subsystem, category: "playback")
    static let download = Logger(subsystem: subsystem, category: "download")
    static let networking = Logger(subsystem: subsystem, category: "networking")
    static let library = Logger(subsystem: subsystem, category: "library")
}
```

`subsystem` should match the bundle identifier already set in `project.yml` (`cloud.samlo.rawkoon`) — this is convention, not a requirement, but it's what Console.app/`log stream` filters expect and it makes `--predicate 'subsystem == "cloud.samlo.rawkoon"'` unambiguous. `category` is the axis for filtering *within* the app (per the audit's own priority: "the `try?` sites in the download and playback paths report their failures" — `.download` and `.playback` are exactly the two categories that matter most for LOG-01's stated goal).

### Privacy annotations and default redaction (confidence: HIGH)

**The critical fact to design around: every interpolated value in a `Logger` call is `.private` by default**, on-device, when the log is read by anything not attached to a debugger (i.e. exactly the situation the audit describes — "a user reports the book will not play," and you pull `log collect`/a sysdiagnose after the fact, not while attached in Xcode). Static string *literals* in the format string are always visible (they can't contain user data by construction) — only the *interpolated* parts are redacted.

```swift
// Redacted to <private> in a field-collected log — useless for the corrupt-cache-style bug the audit cites
Logger.download.error("Failed to write chunk for \(bookID)")

// Explicit opt-in to visibility — use for anything that isn't itself sensitive
Logger.download.error("Failed to write chunk for \(bookID, privacy: .public)")

// Best of both when the raw value *is* sensitive but you still want it correlatable across log lines
Logger.download.error("Auth failed for \(userEmail, privacy: .private(mask: .hash))")
```

For this codebase, the practically important call is: identifiers that are useful for debugging but not meaningfully sensitive — book IDs, download job IDs, HTTP status codes, file sizes, retry counts, error domains/codes — should be `.public`. Anything that's actually PII (email, auth tokens, server URLs if they encode a username, file paths under the user's home directory) should stay `.private` (the default) or use `.private(mask: .hash)` if correlation across log lines matters more than raw visibility. Given LOG-01's stated goal is diagnosing the download/playback `try?` sites, **the single most common mistake to avoid is logging the discarded error without marking its interpretable fields `.public`** — `logger.error("Chunk download failed: \(error)")` will typically still show *some* structure because `Error`/`String(describing:)` interpolation of an `Error` conforms differently than a raw string in some cases, but don't rely on that — be explicit:

```swift
} catch {
    Logger.download.error("Chunk download failed for \(bookID, privacy: .public): \(error, privacy: .public)")
}
```

### Retrieval — the practical story (confidence: HIGH for commands, MEDIUM for exact device-side UX specifics which can shift release to release)

Three distinct retrieval paths depending on where the failure happened:

**1. Simulator, live, while developing/debugging:**
```bash
xcrun simctl spawn booted log stream --level debug \
  --predicate 'subsystem == "cloud.samlo.rawkoon"'
```

**2. Simulator or connected device, after the fact (not attached, e.g. after reproducing a bug once and then wanting the trailing history):**
```bash
xcrun simctl spawn booted log show --last 30m \
  --predicate 'subsystem == "cloud.samlo.rawkoon"' --style compact
```

**3. Real device, from a user/tester who isn't at a terminal (the actual field-bug scenario the audit describes — "the book will not play," reported after the fact by a TestFlight tester):** this is where `.public`/`.private` matters most, because the retrieval mechanism here is one step removed from a live debug session. Two options, in order of practicality for a self-hosted indie app without an MDM fleet:
   - **`sysdiagnose`** — the tester triggers it on-device (hold Volume Up + Volume Down together briefly, then hold the side button until the screen flashes; on some iOS versions it's accessible via Settings > Privacy & Security > Analytics & Improvements > Analytics Data, listed as a `sysdiagnose_*.tar.gz` file after a few minutes), then AirDrops or emails the resulting archive, which contains a full unified-log extract among a large amount of other system diagnostic data. Heavyweight, but works without a cable and without the tester being technical.
   - **Cable-connected + Xcode**: `Window > Devices and Simulators > (select device) > View Device Logs`, or from the command line, `log collect --device-udid <UDID> --last 1h --output rawkoon-device.logarchive` (requires the device connected, unlocked, and "trust this computer" already accepted) — practical only when you have physical access to the device or the tester can bring it to you, which is realistically the case for a small self-hosted-app user base.

For this milestone specifically, the retrieval story that matters most is #2 during the phase's own manual verification (the `macbuild` ssh host running the simulator) and #3-sysdiagnose as the eventual payoff for real users — worth stating plainly in the phase's acceptance criteria that "log stream" against the `macbuild` simulator, filtered on subsystem, is the verification method for LOG-01, not just "no crash."

### Sources

- [SwiftLee — OSLog and Unified Logging as recommended by Apple](https://www.avanderlee.com/debugging/oslog-unified-logging/)
- [Logging Privacy Shenanigans — steipete.me](https://steipete.me/posts/2025/logging-privacy-shenanigans)
- [Apple — Explore logging in Swift, WWDC20](https://developer.apple.com/videos/play/wwdc2020/10168/)
- [`log` man page device options (`--device-udid`, `collect`)](http://www.mac4n6.com/blog/2020/9/8/analysis-of-apple-unified-logs-entry-12-quick-amp-easy-unified-log-collection-from-ios-devices-for-testing)
- [simctl log stream/show usage — xcblog](https://medium.com/xcblog/simctl-control-ios-simulators-from-command-line-78b9006a20dc)

---

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
