# iOS clean-code milestone — execution design — 2026-09-01

One spec to clear the iOS board. It consolidates the remaining `apps/ios`
clean-code work and the two audiobook finish-lines into a single phased
milestone, measured against `origin/main @ 60d9957`.

This is an **execution design**, not a fresh architecture. The *what* was
already decided in `apps/ios/docs/code-quality-audit.md` (the ranked audit) and
in the board notes on the tasks below. This document sequences that work,
resolves the behavior-change tensions, and states exactly where an agent stops
and Sam takes over.

## Tasks this spec absorbs

| Task | Title | Disposition here |
|---|---|---|
| #966 | iOS clean-code backlog (ex-GSD roadmap) | The spine — phases 1–5 |
| #959 | Audio session interruption resume, car remote, smart rewind, AirPlay | Phase 0 (merge) + **handoff** |
| #922 | Haptics pass | Phase 6, rescoped |
| #919 | CarPlay entitlement + scene | **Parked** — Apple-gated, single user action recorded |
| #928 | Keychain writes ignore status | **Out of scope this milestone** (Sam: "ignore this one") |

Already closed during planning: #961 (duplicate of #966, archived), #921
(foliate reader — not pursued, current scroll reader retained), #930 (decision
record).

## Hard rules (from `.claude/CLAUDE.md`, the milestone charter)

These constrain every phase and are not re-litigated per phase:

1. **No user-visible behavior change** — including layout and wording. Haptics
   (phase 6) is the one deliberate exception: it is additive tactile feedback,
   explicitly requested, and device-gated. Localization is **parked** this
   milestone, so no string mechanism changes here.
2. **macbuild ssh is the only real gate.** A green Linux run covers `RawkoonKit`
   alone. No phase is "done" on Linux. Always resync and print the sha first
   (`git fetch -q origin && git checkout -q -B <branch> origin/<branch> &&
   git log --oneline -1`) — a stale checkout fakes `BUILD SUCCEEDED`.
3. **Shippability is proven by `lint`, `kit`, `build` green on the push to
   `main`**, not by an upload.
4. **No agent cuts a release.** Publishing a GitHub release uploads to
   TestFlight *and* redeploys production via `DEPLOYER_WEBHOOK_URL`. It is Sam's
   decision alone. Never bump the version or tag to satisfy a gate.
5. **No on-device state migration.** The position journal, Keychain entries, and
   downloaded library must survive an app update untouched.
6. **Guardrails before refactors** — the linter and the compiler hold the new
   boundaries, not review alone.

## Verification facts worth not rediscovering

- Background `URLSession` downloads do **not** complete in the simulator (every
  task fails `NSURLErrorUnknown`). Never design a check that depends on one.
- The chapter-content route is not behind `requireUser`; auth is a signed HMAC
  `grant` query param, so corrupting the grant deterministically forces a 401
  for error-path testing.
- `formatDuration` is pure arithmetic and identical everywhere → exact-string
  assertions are safe on Linux CI. `formatBytes`/`formatSpeed` go through
  `ByteCountFormatter`, whose swift-corelibs-foundation implementation differs
  from Darwin's → assert *behavior* on Linux, capture exact strings on macOS
  only.
- Several checks (Maps interruption, route disconnect, steering-wheel buttons,
  Lock Screen artwork, haptics) are simulator-proof and can only pass on a
  device.

---

## Phase 0 — Land the audio work already in flight (#959)

**State on main:** PR #60 was squash-merged as `847ce05`. Five review-fix
commits remain **unmerged** on `feat/ios-audio-session-and-car`:

```
5204527 fold smart rewind into the seek that starts playback
803c1f8 harden the interruption state machine
1c463a8 drop the route observer, make the interruption rules testable
d2c9143 don't cancel an in-flight seek when an interruption ends
e6d0bdf own the remote-command targets, trust the player after a cancelled seek
```

These are the outcomes of three independent review rounds (two Cursor/Grok, one
Codex) and each fixed a real bug the previous round's fix introduced — the
route-observer regression that would reintroduce the original in-car bug, and
the seek-cancel-on-resume regression. They must not be dropped.

**Work:** open a PR merging those five commits onto main. macbuild must show
`swift test` 72/0 and `xcodebuild BUILD SUCCEEDED` at the merged sha before the
PR merges.

**Exit / handoff — an agent cannot close #959:**
- Sam runs the in-car drive test. Interruption resume, nested interruptions,
  route disconnect, and steering-wheel buttons have never made a sound on
  hardware. That drive is the entire point of the change.
- Sam decides the **10s rewind-floor** question: a typical ~5s navigation prompt
  currently gets no rewind (floor is 10s), which is the exact reported case. The
  curve was approved as-is; only Settings copy was corrected. Lowering the floor
  is Sam's call.

The PR description must say plainly that CI did not exercise any of this on
hardware.

---

## Phase 1 — Finish the guardrails (#966, audit order item 2) — S

SwiftLint + SwiftFormat and the `Log` namespace already shipped (v1.12.7). This
phase closes the logging surface:

- Route the remaining download/playback `try?` sites (audit counted 56 total;
  the download/playback path is the subset that matters for field diagnosis)
  through `catch { Log.<domain>.error(...) }`.
- Wire `Log.network`, which exists with **zero call sites** today, into the
  download path landed in phase 2.

**Verify:** macbuild `kit` + `build` green; `lint` green. No behavior change.

---

## Phase 2 — Mechanical dedup (#966, audit items 3/4) — S, behavior-preserving

### 2a. Formatters → `RawkoonKit`

`formatSpeed` (×3), `formatDuration` (×3), `formatBytes` (×2) move into
`RawkoonKit` beside `BookTimeline`, under test.

**This is not a pure merge.** Per the phase-2 planning note on #966, the copies
disagree in ways that reach the common case:

| | ContinueListeningView / BookView | MediaDetailView |
|---|---|---|
| minutes after an hour | `%02dm` → `2h 05m` | `\(remaining)m` → `2h 5m` |
| seconds → minutes | `Int(seconds.rounded())` | `Int(seconds / 60)` (truncates) |
| zero / non-finite | guarded → `"0:00"` | already fixed on main (`33d54be`) |

A 2h05m film renders `2h 5m` on the detail screen and `2h 05m` in Continue
Listening **today**. Collapsing to one body silently changes one screen — a
banned visible change. So:

- **Preserve both renderings.** The kit exposes the distinct behaviors (e.g. a
  `padMinutes` parameter, or two named functions), not a single winner.
- `formatBytes` likewise: `MediaDetailView` echoes raw input on parse failure and
  accepts zero/negative; `BookView` returns nil on `<= 0` and its callers omit
  the metric. Both behaviors preserved.
- **Capture current rendered strings before deleting anything** — the old output
  is unrecoverable afterward except by git archaeology. A naive capture harness
  traps on the non-finite inputs; record `"traps"` as the observed result for
  those cells rather than letting the harness die.

**Verify:** exact-string tests for `formatDuration` on Linux; behavior tests for
`formatBytes`/`formatSpeed` on Linux, exact strings captured on macOS only.
macbuild `kit` green. Rendered output on both screens byte-identical to before.

### 2b. Downloads → `APIClient`

`URLSession.shared.download` in `ContinueListeningView`, `BookView`,
`DebugScreens` → a new `APIClient.downloadFile(path:)` (~15 lines composing the
existing `makeRequest`/`mapStatus`) so they carry the bearer header and surface
`APIError`.

**Constraint:** routing `ContinueListeningView.openEbook` through `mapStatus`
would turn a 401's `"Network error. Check your connection."` into
`"Sign in required."` — a visible string change. **Not this milestone.** Keep the
existing user-facing copy on the download error path; gain the auth header and
cookie-less session without changing what the user reads. The string improvement
is deferred to the parked localization work.

**Verify:** macbuild `build` green. Existing error copy unchanged.

---

## Phase 3 — Observation + strict concurrency (#966, audit items 5/6) — M

### 3a. `ObservableObject` → `@Observable`

Three classes, 22 `@Published`. `@Observable` tracks reads per-property, so a
view reading only `player.isPlaying` stops re-rendering when `positionSecs` ticks
each second — a continuous cost with a mini player on every screen.

- No `$property` publisher survives `@Observable`, so `bindPlayer()`'s Combine
  relay is **deleted, not translated**.
- `AppModel.manifests` is `private` but body-reachable via `activeBook()` in
  `MiniPlayerView` — it must stay tracked.

### 3b. Swift 6 language mode

Sequence: `SWIFT_STRICT_CONCURRENCY = targeted` → fix `Sendable` → fix actor
isolation → flip to `.v6` (both modules). The migration is small because value
types are already `Sendable` and `AppModel` is already `@MainActor`.

- **Tripwire:** `grep -c 'Task {' AudiobookPlayer.swift` returns exactly **1**
  today (line ~885, `loadArtwork`, already fire-and-forget). It must stay 1, or
  each addition is justified per-site — a mechanical guard against the
  `Task { @MainActor in }` substitution that would re-ship the v1.12.6
  interruption race.
- Real diagnostic to expect: `itemStatusObserver`'s `DispatchQueue.main.async`
  captures a non-`Sendable` `AVPlayerItem` — snapshot `item.status` before
  crossing. Use `assumeIsolated` only where the SDK guarantees main-queue
  delivery; `currentItem` KVO, item-status KVO, and `MPRemoteCommandCenter`
  handlers need a real hop.
- Readium 3.11.0 predates its own Swift 6 migration by a month → `@preconcurrency
  import` expected in ebook code.

**Verify:** macbuild `kit` + `build` green under `.v6`. Four on-device checks
(Maps interruption, rapid toggle, route disconnect, steering-wheel) are Sam's —
the simulator cannot judge them. No behavior change intended; the tripwire is the
guard against silently re-introducing the race.

---

## Phase 4 — Seams and view models (#966, audit items 7/8) — M/L

The item that changes how the app is maintained. Deliberately after phases 1 and
3, so the linter and the Swift 6 compiler both hold the new boundaries.

- **Split `APIClient`** (982 LOC, ~70 endpoints) into `extension APIClient` files
  per domain (library, books, downloads, admin, discovery). No behavior change.
- **Add an app-target test bundle.** There is none today, which is why several
  checks can only be done by hand. This bundle is what phase 5's `xcodebuild
  test` runs.
- **Extract `MediaDetailViewModel` (from 1,443 LOC / 34 `@State`) and
  `BookViewModel` (from 1,227 LOC)** as `@Observable` models. Views drop to
  rendering; the request/error/retry logic that actually breaks in the field
  becomes testable without a renderer. Unit-test the extracted models in the new
  bundle.

**Verify:** macbuild `build` green; new app-target tests green on the simulator.
Screens render identically — extraction is behavior-preserving.

---

## Phase 5 — Test job + accessibility (#966, audit order item 10 + a11y) — M

- Add an `xcodebuild test` job to `ios.yml` with a simulator test plan. Select
  the destination dynamically (`simctl list devices available`); do not hardcode
  a device name — it may not exist on a given `macos-26` runner. The job runs the
  phase-4 app-target bundle plus the RawkoonKit tests.
- Add accessibility labels to icon-only controls (player close, AirPlay chip, and
  the other icon-only buttons — 18 a11y modifiers across 9,004 LOC of views
  today). Note the AVRoutePickerView already names itself; do not double-label it.

**Verify:** the test job runs and passes on CI; VoiceOver reads the icon-only
controls (device/simulator accessibility inspector).

---

## Phase 6 — Haptics (#922), rescoped — L

Unblocked now that the foliate reader is not being pursued.

- New `Rawkoon/Haptics.swift`: an `AppHaptic` enum plus one pure mapping to
  `SensoryFeedback`. Call sites name the event, never pick a vibration. The pure
  mapping lives testable in `RawkoonKit`.
- `.sensoryFeedback(_:trigger:)` (iOS 17+, target 18) — honors the system haptics
  setting, so no app-level toggle.
- **Triggers (rescoped):** network outcomes (grab/add/approve/deny success &
  failure, via a single `lastHaptic` on `AppModel` with one root modifier),
  play/pause, ±30s skips, chapter-boundary crossing, sleep-timer firing. Two new
  monotonic counters on `AudiobookPlayer` (`skipCount`, `sleepFiredCount`)
  because the sleep timer fires internally with no published change.
- **Page-turn trigger DROPPED** — it was the one trigger blocked on the paginated
  reader, and the retained reader is scroll-based with no page events.
- **Exclusion:** of the `errorMessage =` paths, fire only on errors from an
  explicit user action — background-refresh failures must not buzz a pocketed
  phone.

**Verify:** haptics do not fire in the simulator → device pass by Sam; expect to
dial `.skipped` back afterward. Note in the milestone that haptics is the one
intentional additive behavior of this pass.

---

## Parked — recorded, not phases

### #919 CarPlay — Apple-gated

The only actionable step is a **user action**: Sam files the
`com.apple.developer.carplay-audio` entitlement request with Apple (granted by
application only; weeks of turnaround, can be declined). It must be in the
provisioning profile before the Xcode CarPlay Simulator will even load the app,
so it gates development, not just release.

Foundations already exist (`AVAudioSession .playback/.spokenAudio`,
`MPRemoteCommandCenter`, `MPNowPlayingInfoCenter`). Once the entitlement is
granted, the remaining build is a `CPTemplateApplicationScene`, a `CPListTemplate`
hierarchy (authors → books → chapters), `CPNowPlayingTemplate`, and offline-vs-
streaming behavior. Audio and steering-wheel controls already work over
Bluetooth today; the gap is only browsing on the car screen.

### #928 Keychain robustness — out of scope this milestone

Kept on the board, not folded in (Sam: "ignore this one"). Not a shipped
user-facing bug: signed TestFlight builds persist correctly; the silent-logout
symptom is simulator-only (empty entitlements under `CODE_SIGNING_ALLOWED=NO`).

### Localization (#966 audit item 4) — parked

The `.xcstrings` catalog, the 106 hardcoded `Text` sites, and Québécois French
are deferred to a follow-up. Parking it keeps this entire milestone a
no-visible-string-change refactor (haptics aside). When it returns, it is also
the natural home for the two string improvements deferred above (the 401
`openEbook` copy).

---

## Board bookkeeping on completion

- **#966** is the single tracker for phases 1–5; note each phase's merged sha as
  it lands. Close when phase 5 is green on main.
- **#922** closes after the phase-6 device pass.
- **#959** stays open until Sam's drive test; only Sam closes it.
- **#919** stays open, blocked, until the entitlement is granted.
- **#928** stays on the board, untouched.

## Ordering summary

```
0  merge #959 fixes ........ then Sam drives            (audio finish)
1  logging surface ......... S   guardrail
2  formatters + downloads .. S   behavior-preserving
3  @Observable + Swift 6 ... M   tripwire-guarded
4  APIClient split + VMs ... M/L the maintainability win
5  test job + a11y ......... M
6  haptics (#922) .......... L   one intentional additive behavior
── parked: #919 CarPlay, #928 Keychain, localization ──
```

Phases 1–2 are a weekend. Phase 4 is the one that changes how the app is
maintained; it lands on a codebase the linter and the Swift 6 compiler already
hold in shape.
