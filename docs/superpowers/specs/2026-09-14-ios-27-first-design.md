# iOS 27-first Rawkoon design

## Decision

The next iOS app line requires iOS 27.0. We will not keep compatibility code or CI coverage for iOS 18–26. Existing installations on older systems remain on their last compatible App Store version; this change does not alter the server API or delete their server-side data. An in-place upgrade on iOS 27 must retain the Keychain session, downloaded audiobooks and EPUBs, reading positions, and playback progress.

## Release shape

1. **Platform release:** Raise the deployment target, build with the final Xcode 27/iOS 27 SDK, remove the old mini-player path, fix the conditional-tab selection hazard, and validate the existing app on iOS 27. This is independently shippable.
2. **Siri release:** Expose a narrow authenticated audiobook action and entity surface through App Intents, Shortcuts, Spotlight, and iOS 27 audio schemas. This is independently shippable after the platform release.
3. **Now Playing release:** Replace the existing MediaPlayer metadata/command path with the iOS 27 Now Playing framework in one switchover. This is independently shippable after the platform release and must never run both paths for local playback.

Do not bundle a Foundation Models feature into this migration. Rawkoon already has server-driven discovery/search; a useful on-device model use case needs its own product design and evaluation. Do not add a widget or Live Activity merely to display a second copy of playback controls already provided by the system.

## Platform constraints

- `apps/ios/project.yml` and `apps/ios/Package.swift` minimum iOS version: **27.0**.
- Xcode: **27 final**, Swift compiler **6.4**; retain Swift **6 language mode** (`SWIFT_VERSION: "6.0"`) unless a separate migration proves a language-mode change necessary.
- Xcode 27 requires macOS Tahoe **26.6+**. The GitHub Actions `xcode-27` runner is the planned build/archive host; verify its actual image and installed simulator before hard-coding a destination.
- Preserve the iPhone-only target, dark phone appearance, CarPlay day/night behavior, iOS bundle ID, signing identity, background modes, and existing launch screen.
- Keep Readium pinned at 3.11.0 unless an Xcode 27 compile/runtime failure gives a concrete reason to change it.
- Do not release from an agent session. A published GitHub release remains the only TestFlight upload trigger.

## Acceptance

- The app builds, launches, and runs on an iOS 27 simulator and a real iOS 27 iPhone; no iOS <27 simulator is required.
- Switching or losing admin status cannot leave `TabView` selecting a removed Home tab.
- Local and streamed audio, background/interruption resume, lock-screen and CarPlay commands, AirPlay route changes, chapter skip/rate/seek, and background download completion behave as before.
- EPUB opens, paginates, resumes, and preserves reading position after an in-place update.
- Login, push registration/deep links, offline library, Keychain persistence, and downloaded files survive an in-place update.
- Siri actions fail closed when logged out, never index private library titles without an explicit product decision, and give a clear unavailable result on unsupported devices/languages.
- A Now Playing migration retains all current command semantics and does not load `MPNowPlayingInfoCenter` or `MPRemoteCommandCenter` alongside the new local session.

## Evidence

- [iOS 27 release notes](https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes): selected `TabView` value must be visible; apps built with SDK 27 require a launch screen and scene lifecycle.
- [Xcode 27 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes): Swift 6.4 and macOS 26.6 minimum.
- [GitHub runner images](https://github.com/actions/runner-images): `xcode-27` runner label.
- [iOS 27 App Intents](https://developer.apple.com/ios/whats-new/) and [audio schema](https://developer.apple.com/documentation/appintents/app-schema-domain-audio): Siri/Spotlight content and action integration.
- [Now Playing framework](https://developer.apple.com/documentation/nowplaying): do not mix with MediaPlayer local-playback APIs.
