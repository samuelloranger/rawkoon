# iOS 27 device validation

The platform release's acceptance gate. A simulator cannot prove background
session relaunch, audio route/interruption handling, or CarPlay behavior — this
must run on a real iOS 27 iPhone. Record device/OS/build and pass/fail per line;
resolve any failure before cutting a release.

- **Device / OS / build:** _(fill in)_
- **Date:** _(fill in)_
- **Tester:** _(fill in)_

## In-place upgrade (data survival)

Install the previous production/TestFlight build first, then upgrade the same
install to the iOS 27 build.

- [ ] Sign in, download one audiobook and one EPUB, start playback, save a reading position
- [ ] Upgrade in place to the iOS 27 build
- [ ] Keychain session survives (still signed in)
- [ ] Downloaded audiobook + EPUB files survive
- [ ] Playback progress survives
- [ ] EPUB reading position survives

## Audio transport

- [ ] Streamed chapters: play / pause / resume / scrub / speed / chapter skip / sleep timer
- [ ] Local (downloaded) chapters: same set
- [ ] Interruptions: phone call, Siri, navigation prompt — pause then resume correctly
- [ ] Bluetooth disconnect / reconnect
- [ ] AirPlay route change
- [ ] Lock Screen controls
- [ ] Control Center controls

## CarPlay

- [ ] Steering-wheel controls
- [ ] Now Playing controls + metadata
- [ ] Automatic MiniPlayer layout (iOS 27)
- [ ] Day / night appearance behaves as before

## Background downloads

- [ ] Start a background chapter download, lock phone, relaunch after system completion — files + UI state correct
- [ ] Rapid cancel → re-download (board #973): note pass/fail; a failure is a
      separate pre-existing bug unless the iOS 27 change caused it

## App surfaces

- [ ] Login / logout
- [ ] Admin-role switch (Home tab appears/disappears, selection stays visible)
- [ ] Push registration + notification deep links
- [ ] Offline library
- [ ] EPUB open / paginate / resume

## Result

_(pass / fail summary + any reproduction steps for failures)_
