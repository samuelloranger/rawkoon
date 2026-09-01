# Requirements: Rawkoon iOS — clean-code pass

**Defined:** 2026-09-01
**Core Value:** The app keeps shipping — every phase ends with a TestFlight build that behaves exactly as the one before it.

## v1 Requirements

Requirements for this milestone. Each maps to one roadmap phase. Source: `apps/ios/docs/code-quality-audit.md`.

Every requirement inherits two acceptance conditions that are not repeated below:
`swift test` passes on Linux, and `xcodebuild build` succeeds on the macbuild host.
A requirement is not complete without both.

### Guardrails

- [ ] **LINT-01**: `.swiftlint.yml` and a SwiftFormat config are committed under `apps/ios`, and both tools run clean over `Rawkoon/`, `Sources/`, and `Tests/`
- [ ] **LINT-02**: `file_length`, `type_body_length`, and `function_body_length` are enabled as warnings with thresholds just above today's worst offenders, so no file can grow past its current size
- [ ] **LINT-03**: A `lint` job in `.github/workflows/ios.yml` fails the build on a lint or format violation, and runs before the expensive macOS jobs
- [ ] **LINT-04**: Every rule disabled project-wide carries a comment saying why; no blanket `disabled_rules` dump
- [ ] **LOG-01**: A single logging surface exists (`Logger(subsystem: "cloud.samlo.rawkoon", category:)`), with one category per domain: playback, download, network, auth, sync
- [ ] **LOG-02**: Every `try?` in the download and playback paths either reports its failure through that logger or carries a comment explaining why the error is genuinely uninteresting
- [ ] **LOG-03**: No logged value leaks a bearer token, a password, or a full server URL with credentials; privacy annotations are explicit where a value is deliberately public
- [ ] **LOG-04**: `docs/` records how to pull logs off a device and off the simulator

### Shared logic and network discipline

- [ ] **KIT-01**: Byte, duration, and speed formatting exist once, in `RawkoonKit`, with unit tests covering zero, negative, non-finite, and boundary inputs
- [ ] **KIT-02**: All eight private copies in `MediaDetailView`, `BookView`, `ActivityView`, `DownloadClientView`, and `ContinueListeningView` are deleted and call the shared functions
- [ ] **KIT-03**: Output strings are unchanged from what each call site produced before, or every difference is listed and deliberate
- [ ] **NET-01**: The three raw `URLSession.shared.download` calls in `ContinueListeningView`, `BookView`, and `DebugScreens` go through `APIClient`
- [ ] **NET-02**: Those downloads carry the auth header and use the cookie-less ephemeral session, matching every other request
- [ ] **NET-03**: Failures surface as `APIError`, not as an untyped `URLError`

### Observation

- [ ] **OBS-01**: `AppModel`, `AudiobookPlayer`, and `ReaderChrome` are `@Observable`; no `ObservableObject` or `@Published` remains in the target
- [ ] **OBS-02**: Every `@StateObject` / `@ObservedObject` / `@EnvironmentObject` call site is converted, and the app builds with no observation-related warnings
- [ ] **OBS-03**: The Combine pipeline in `AppModel.bindPlayer()` is replaced with an equivalent that fires on the same transitions — playback progress must still persist on pause, and the persistence throttle must keep its current cadence
- [ ] **OBS-04**: A view that reads only one property of the player no longer re-renders on every position tick

### Swift 6

- [ ] **CONC-01**: `RawkoonKit` builds under Swift 6 language mode with no warnings
- [ ] **CONC-02**: The app target builds clean under `SWIFT_STRICT_CONCURRENCY = complete`, then under Swift 6 language mode
- [ ] **CONC-03**: `AudiobookPlayer`'s notification observers, KVO on `currentItem`, periodic time observer, and `MPRemoteCommandCenter` handlers are correctly isolated — and the `currentItem` KVO no longer touches observable state off the main actor
- [ ] **CONC-04**: No `@unchecked Sendable` and no `nonisolated(unsafe)` is introduced without a comment justifying it against the alternative
- [ ] **CONC-05**: No remote command, interruption resume, or seek gains a `Task` hop that was not there before, unless the hop is shown to be necessary — a deferred play/pause is a user-visible regression
- [ ] **CONC-06**: The `InterruptionPolicy` and `SmartRewind` test suites still pass unchanged, and the manual drive test (start a chapter, let Maps speak, playback resumes) is re-run on device

### Decomposition

- [ ] **API-01**: `APIClient` is split into per-domain extension files — library, books, downloads, discovery, admin — with stored properties, `init`, and the private request helpers staying in the core file
- [ ] **API-02**: No endpoint method's signature or behavior changes; the split is a move
- [ ] **VM-01**: `MediaDetailView` has an `@Observable` view model holding its network calls, error handling, and derived state; the view keeps only genuinely view-local state
- [ ] **VM-02**: `BookView` has the same treatment
- [ ] **VM-03**: Both view models are unit-tested without a renderer, against a fake API dependency — covering at minimum the loading, empty, error, and success paths of each fetch
- [ ] **VM-04**: Both view files are under the `file_length` warning threshold set in LINT-02, and the threshold is lowered to match the new reality

### Reach and regression safety

- [ ] **I18N-01**: A `.xcstrings` String Catalog is the source of every user-facing string; no hardcoded literal remains in a `Text`, button label, alert, or accessibility label
- [ ] **I18N-02**: `fr` is complete — every key has a French value, translated for a Québécois francophone reader, not machine-default French
- [ ] **I18N-03**: English output is byte-identical to today's, so the diff is a mechanism change and not a copy change
- [ ] **I18N-04**: Interpolated and pluralized strings use the catalog's plural rules rather than string concatenation
- [ ] **A11Y-01**: Every icon-only control has an accessibility label — the player transport, close, and AirPlay controls first
- [ ] **A11Y-02**: Progress bars, sliders, and the scrubber expose value and are operable with VoiceOver
- [ ] **A11Y-03**: A VoiceOver pass over the player and the library confirms the labels read sensibly, not just that they exist
- [ ] **TEST-01**: A test plan runs an app-target test bundle in the simulator
- [ ] **TEST-02**: `ios.yml` runs `xcodebuild test` on a simulator resolved at runtime, not a hardcoded device that may vanish from a future runner image
- [ ] **TEST-03**: The suite covers the view models from VM-03 and the logging and formatting behavior from LOG/KIT, and fails the build when red

## v2 Requirements

Acknowledged, not in this roadmap.

### Coverage

- **V2-01**: Tests for the remaining 20 view files
- **V2-02**: UI tests for the sign-in and first-download flows

### Architecture

- **V2-03**: View models for the other 15 views that call `model.api()` directly
- **V2-04**: A repository layer between the view models and `APIClient`
- **V2-05**: Split `AppModel` — it owns auth, library, downloads, playback binding, push, and reading progress in one 739-line type

### Tooling

- **V2-06**: `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, once the strict-concurrency migration has settled
- **V2-07**: Danger or an equivalent to surface lint findings as PR comments

## Out of Scope

| Feature | Reason |
|---------|--------|
| New features or screens | Debt milestone; mixing feature work makes every diff unreviewable |
| Any user-visible behavior or visual change | The acceptance test for each phase is "nothing looks or acts different" |
| `apps/api`, `apps/web`, `apps/shared` | Separate workspaces, separate tooling; the audit covered iOS only |
| iPad and macOS support | `TARGETED_DEVICE_FAMILY = 1` is a deliberate choice |
| Light mode | Dark-only is a design decision, not debt |
| Replacing Readium, XcodeGen, or the signing setup | All three work and all three were expensive to get right |
| CarPlay entitlement | A separate Apple review, unrelated to code quality |
| Rewriting `AudiobookPlayer` | It was stabilized over three releases; this milestone isolates it, it does not redesign it |
| A third-party DI framework | Constructor injection is enough at this size |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LINT-01 | Phase 1 | Pending |
| LINT-02 | Phase 1 | Pending |
| LINT-03 | Phase 1 | Pending |
| LINT-04 | Phase 1 | Pending |
| LOG-01 | Phase 1 | Pending |
| LOG-02 | Phase 1 | Pending |
| LOG-03 | Phase 1 | Pending |
| LOG-04 | Phase 1 | Pending |
| KIT-01 | Phase 2 | Pending |
| KIT-02 | Phase 2 | Pending |
| KIT-03 | Phase 2 | Pending |
| NET-01 | Phase 2 | Pending |
| NET-02 | Phase 2 | Pending |
| NET-03 | Phase 2 | Pending |
| OBS-01 | Phase 3 | Pending |
| OBS-02 | Phase 3 | Pending |
| OBS-03 | Phase 3 | Pending |
| OBS-04 | Phase 3 | Pending |
| CONC-01 | Phase 4 | Pending |
| CONC-02 | Phase 4 | Pending |
| CONC-03 | Phase 4 | Pending |
| CONC-04 | Phase 4 | Pending |
| CONC-05 | Phase 4 | Pending |
| CONC-06 | Phase 4 | Pending |
| API-01 | Phase 5 | Pending |
| API-02 | Phase 5 | Pending |
| VM-01 | Phase 5 | Pending |
| VM-02 | Phase 5 | Pending |
| VM-03 | Phase 5 | Pending |
| VM-04 | Phase 5 | Pending |
| I18N-01 | Phase 6 | Pending |
| I18N-02 | Phase 6 | Pending |
| I18N-03 | Phase 6 | Pending |
| I18N-04 | Phase 6 | Pending |
| A11Y-01 | Phase 6 | Pending |
| A11Y-02 | Phase 6 | Pending |
| A11Y-03 | Phase 6 | Pending |
| TEST-01 | Phase 6 | Pending |
| TEST-02 | Phase 6 | Pending |
| TEST-03 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-01*
*Last updated: 2026-09-01 after initialization*
