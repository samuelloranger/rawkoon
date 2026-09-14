# iOS 27 Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Rawkoon iPhone app built for iOS 27, with iOS 27 as its minimum version and existing media behavior preserved.

**Architecture:** Keep the SwiftUI `WindowGroup`, `AppModel`, Readium reader, and CarPlay scene. Replace only the pre-27 UI branch, validate conditional tab selection at the binding boundary, and move build/archive/test jobs to an Xcode 27 host.

**Tech Stack:** Xcode 27, Swift 6.4 compiler in Swift 6 language mode, SwiftUI, XcodeGen, Readium 3.11.0, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-ios-27-first-design.md`

## Global Constraints

- Minimum iOS version: **27.0** in both app and package.
- Do not change the bundle ID, signing profile, launch screen, server API, local storage formats, or iPhone-only device family.
- Preserve release gating: only a published GitHub release uploads to TestFlight.
- Existing iOS 18–26 users stay on their last compatible app version.

---

### Task 1: Enforce a valid tab selection

**Files:** Modify `apps/ios/Rawkoon/RawkoonApp.swift`; test `apps/ios/RawkoonTests/TabSelectionTests.swift`.

**Interfaces:** Add an internal pure `RootTabSelection.validated(_ selected: String, isAdmin: Bool) -> String`. Its allowed values are `home`, `discover`, `library`, `activity`, `settings`; `home` is allowed only when `isAdmin` is true. Any other selection resolves to `library`.

- [ ] Add tests for `home` with admin true/false, all always-visible tabs, and an unknown value. Expect `home` only for an admin, and `library` for invalid values.
- [ ] Run the app-target tests with the current toolchain and confirm the new tests fail before implementation.
- [ ] Apply `RootTabSelection.validated` in the `TabView(selection:)` binding getter, so the selection is valid during rendering even when `model.isAdmin` changes. Preserve the existing library-to-Home default for admins. Do not rely only on `.onChange` after the invalid view has rendered.
- [ ] Run the focused tests and inspect a role-change simulation: admin on Home → role removed → Library selected; non-admin stays on Library.
- [ ] Commit as `fix(ios): keep tab selection visible`.

### Task 2: Raise the platform floor and remove obsolete UI branches

**Files:** Modify `apps/ios/project.yml`, `apps/ios/Package.swift`, `apps/ios/Rawkoon/RawkoonApp.swift`, `apps/ios/Rawkoon/Views/MiniPlayerView.swift`, and stale platform comments in `apps/ios/Rawkoon/Views/Library/LibraryMediaRow.swift`.

**Interfaces:** Keep `MiniPlayerView(model:onExpand:chromed:)` if used by the debug harness; production calls it only as the iOS 27 `tabViewBottomAccessory`. Delete `MiniPlayerContentInset` and its per-tab modifiers, then simplify `miniPlayerAccessory` to attach the accessory only when an active book exists.

- [ ] Change `deploymentTarget.iOS` from `18.0` to `27.0` and the package platform from `.iOS(.v18)` to `.iOS(.v27)`.
- [ ] Remove the iOS 18 safe-area mini-player branch and `#available(iOS 26.0, *)` checks that only protected the old floor. Retain explicit `AppModel` injection into accessory content because it is hosted outside the root environment.
- [ ] Update comments that claim the target is iOS 18 or describe the deleted fallback. Keep `UILaunchScreen: {}` and the SwiftUI scene lifecycle.
- [ ] Run `swift test`, `swiftformat Rawkoon RawkoonTests Sources Tests --lint`, `swiftlint lint`, `python3 scripts/check-l10n.py`, and `python3 scripts/check-env-inject.py` in `apps/ios`.
- [ ] Commit as `build(ios): require iOS 27`.

### Task 3: Move CI and release builds to Xcode 27

**Files:** Modify `.github/workflows/ios.yml`; update `apps/ios/docs/log-retrieval.md` only if its build instructions name an obsolete toolchain.

**Interfaces:** Build and TestFlight jobs use GitHub's `xcode-27` runner; the Linux `kit` job continues testing package logic. Keep the release-only `testflight` condition and existing signing/export steps.

- [ ] On an `xcode-27` job, record `sw_vers`, `xcodebuild -version`, `xcodebuild -showsdks`, and `xcrun simctl list devices available`. Confirm final Xcode 27 and an iOS 27 simulator before pinning a test destination.
- [ ] Change both macOS jobs from `macos-26` to `xcode-27`; remove `Select Xcode 26` steps. Keep `SWIFT_VERSION: "6.0"` as language mode; Xcode 27 supplies the Swift 6.4 compiler.
- [ ] Add an app-target `xcodebuild test` job or step using the available iOS 27 simulator, including `TabSelectionTests` and the current `RawkoonTests` bundle. Keep the generic simulator build and archive checks.
- [ ] Resolve any Xcode 27 compiler errors at their responsible call sites, particularly SwiftUI `@State` macro source-compatibility changes; test each fix rather than changing the Swift language mode or Readium pin preemptively.
- [ ] Confirm `xcodegen generate`, simulator build/test, Release archive, export, and signing on the new runner. Do not publish a release as a CI experiment.
- [ ] Commit as `ci(ios): build with Xcode 27`.

### Task 4: Validate the upgrade on a real iOS 27 phone

**Files:** Add `apps/ios/docs/ios-27-device-check.md` with dated results and any reproduction steps; modify affected source only for verified failures.

**Interfaces:** This is the acceptance gate for a release. A simulator cannot prove background session relaunch, audio route/interruption handling, or CarPlay behavior.

- [ ] Install the previous production/TestFlight app, sign in, download an audiobook and EPUB, start playback, and save a reading position. Upgrade the same installation to the iOS 27 build and verify Keychain, downloads, progress, and reader position remain.
- [ ] Exercise streamed and local chapters, pause/resume, scrub, speed, chapter skip, sleep timer, phone/Siri/navigation interruption, Bluetooth disconnect/reconnect, AirPlay, Lock Screen, Control Center, and CarPlay steering-wheel/Now Playing controls.
- [ ] Start a background chapter download, lock the phone, relaunch after system completion, and verify the files and UI state. Also test the existing rapid cancel→re-download concern tracked in board #973; treat a failure as a separate pre-existing bug unless the iOS 27 change caused it.
- [ ] Verify login/logout, admin-role switch, push registration and notification deep links, offline library, EPUB pagination, and iOS 27 CarPlay's automatic MiniPlayer layout.
- [ ] Record pass/fail and device/OS/build numbers. Resolve failures before the release gate, then commit the evidence document as `docs(ios): record iOS 27 device validation`.

**Stop condition:** CI passes on Xcode 27 and the device checklist passes. The platform release is ready for human-controlled publication; Siri and Now Playing work can proceed independently.
