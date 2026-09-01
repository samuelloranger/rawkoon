# Rawkoon iOS — clean-code pass

## What This Is

Rawkoon's native iPhone companion app: a SwiftUI client for the self-hosted
Rawkoon server that discovers titles, manages the download queue, and plays
downloaded audiobooks and ebooks offline. It ships to TestFlight from GitHub
Actions and is at v1.12.6.

This milestone is not a feature milestone. It is a structural pass over
`apps/ios` that pays down the debt catalogued in
`apps/ios/docs/code-quality-audit.md` — no user-visible behavior changes, no new
screens — so that the next feature is cheap to build and the next bug is
possible to diagnose.

## Core Value

The app keeps shipping. Every phase ends with a build that installs from
TestFlight and behaves exactly as the one before it — a refactor the user can
feel is a failed refactor.

## Requirements

### Validated

<!-- Already true of the shipped app. These are the constraints the refactor must not break. -->

- ✓ Offline audiobook playback with chapter downloads, Now Playing, remote
  commands, and interruption resume — existing (v1.12.6)
- ✓ Ebook reading through Readium — existing
- ✓ Library, discovery, requests, activity, and admin screens against the
  Rawkoon API — existing
- ✓ Bearer-token auth with SSO/OAuth, token in the Keychain — existing
- ✓ APNs push registration and notification preferences — existing
- ✓ `RawkoonKit` as a pure-logic SPM package tested on Linux CI (72 tests) — existing
- ✓ TestFlight delivery from `ios.yml` with pinned manual signing — existing

### Active

- [ ] **LINT-01**: SwiftLint and SwiftFormat configured, committed, and enforced by a CI job
- [ ] **LOG-01**: `os.Logger` per domain; the discarding `try?` sites in the download and playback paths report their failures
- [ ] **KIT-01**: The duplicated byte/duration/speed formatters live once in `RawkoonKit`, with tests
- [ ] **NET-01**: Every network call goes through `APIClient`; no raw `URLSession.shared` in views
- [ ] **OBS-01**: `ObservableObject`/`@Published` replaced by `@Observable`
- [ ] **CONC-01**: Swift 6 language mode on both the app target and `RawkoonKit`, strict concurrency clean
- [ ] **API-01**: `APIClient` split into per-domain extensions
- [ ] **VM-01**: `MediaDetailView` and `BookView` reduced to rendering, with tested `@Observable` view models
- [ ] **I18N-01**: String catalog with `en` and `fr`; no hardcoded user-facing literals
- [ ] **TEST-01**: CI runs `xcodebuild test` against the app target with a simulator test plan
- [ ] **A11Y-01**: Icon-only controls carry accessibility labels

### Out of Scope

- New features, screens, or API endpoints — this is a debt milestone; feature
  work would make every diff unreviewable
- Any user-visible behavior change, including visual changes — the acceptance
  test for each phase is "nothing looks or acts different"
- `apps/api`, `apps/web`, `apps/shared` — separate workspaces with their own
  tooling; the audit covered iOS only
- iPad or macOS support — the app is `TARGETED_DEVICE_FAMILY = 1` by choice
- Light mode — dark-only is a design decision, not debt
- Replacing Readium, XcodeGen, or the signing setup — all three work and all
  three were expensive to get right
- A CarPlay entitlement — a separate Apple review, unrelated to code quality

## Context

**Where the debt is.** 68% of the app is view files (9,004 LOC across 22 files).
All 72 tests cover `RawkoonKit`, which is 5% of the Swift. 17 of 22 views call
`model.api()` and run their own `Task {}`. `MediaDetailView` is 1,443 lines with
34 `@State` properties; `BookView` is 1,227.

**What is already right, and must survive.** `RawkoonKit` proves the extraction
pattern works here — pulling the interruption state machine into a pure function
is what stopped it regressing across three review rounds. `APIClient` is an
`actor`. There are zero force unwraps, zero `try!`, zero `as!` in the target.
Value types crossing the API boundary are already `Sendable`, which is why the
Swift 6 phase is smaller than it looks. The Keychain, the theme tokens, and the
pinned Readium version are all correct as they stand.

**How this app is verified.** Linux CI can build and test `RawkoonKit` only.
Anything touching the app target — compile, simulator, screenshots — runs on the
`macbuild` ssh host. A green Linux run says nothing about whether the app builds.
Xcode 26 / iOS 26 SDK, deployment target iOS 18.

**Project layout.** XcodeGen generates `Rawkoon.xcodeproj` from `project.yml`;
the `.xcodeproj` is not committed, so build settings are edited in `project.yml`.
`RawkoonKit` is a local SPM package at `apps/ios/Package.swift`. The marketing
version comes from the root `package.json` via CI, and the build number is
`github.run_number`.

**Recent history worth knowing.** v1.12.4–v1.12.6 were audio-player fixes: a
corrupt local-cache bug, Now Playing artwork and player dismissal, then
interruption handling so an Apple Maps prompt no longer kills playback. Each of
those took multiple review rounds, and each round found a bug introduced by the
previous round's fix — which is the strongest argument in this document for the
guardrail phases coming first.

## Constraints

- **Verification**: the `macbuild` ssh host is the only real gate — Linux builds
  `RawkoonKit` alone, so no phase is "done" on a green Linux run
- **Shippability**: the app must archive and upload to TestFlight after every
  phase — a phase that leaves `main` unshippable is not complete
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

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Debt milestone with no feature work | Every feature diff mixed into a refactor makes both unreviewable, and the audit's top item is untestable code | — Pending |
| Guardrails first, view models last | Items 1–4 are mechanical and cheap; landing them first means the expensive refactor arrives on a codebase the linter and Swift 6 already police | — Pending |
| Swift 6 mode before extracting view models | The compiler should be checking actor isolation while the player and view state are being moved, not after | — Pending |
| Sequential execution, no parallel plans | Every item touches the same Swift files, and there is exactly one build host | — Pending |
| Localization deferred until after the view-model work | Touching 106 string sites is far cheaper once the views are decomposed | — Pending |
| Keep `RawkoonKit` as the test home | It already builds and tests on Linux CI in seconds; growing it is free, and it is why extracted logic stays correct | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-01 after initialization*
