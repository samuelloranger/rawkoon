# Domain Pitfalls: Swift 6 Strict Concurrency Migration — `AudiobookPlayer.swift`

**Domain:** iOS Swift 6 strict-concurrency migration for an AVFoundation/MediaPlayer audiobook player
**Researched:** 2026-09-01
**Overall confidence:** Mixed, tagged per finding. HIGH = Apple docs / Swift Evolution / direct SDK behavior. MEDIUM = corroborated across multiple credible Swift-community sources (massicotte.org, avanderlee.com, donnywals.com, fatbobman.com, mjtsai.com — all recognized Swift-concurrency specialists) but not an Apple primary source. LOW = single source or my own synthesis applied to this file, flagged explicitly.

This file targets the four questions in the research brief directly. It assumes the reader has `apps/ios/Rawkoon/AudiobookPlayer.swift` open — every finding below names the construct and line range it applies to (line numbers as of commit `602a6e0`, v1.12.6).

---

## 1. Migration order and mechanics

### Module order: RawkoonKit first, and go straight to `.v6` there

`RawkoonKit` is pure logic, has zero AVFoundation/UIKit/MediaPlayer surface, is 660 LOC, and — critically — is the only part of this app Linux CI can build and test in seconds. That combination (small, no platform-framework entanglement, fast feedback loop) means the normal "targeted → fix → complete → fix → v6" crawl is overkill for it. Skip straight from `.swiftLanguageMode(.v5)` to `.swiftLanguageMode(.v6)`, run `swift test` locally and on Linux CI, and fix what breaks in one pass. (MEDIUM — this is a judgment call built on Apple's own module-by-module guidance below, not a documented recipe.)

The app target is the opposite: 4,173 LOC of app core plus 9,004 LOC of views, AVFoundation, MediaPlayer, KVO, and only verifiable on the `macbuild` host. For it, do the full crawl: `SWIFT_STRICT_CONCURRENCY = targeted` → fix diagnostics → `= complete` → fix diagnostics → `SWIFT_VERSION = 6.0`. Apple's own guidance and multiple independent migration write-ups agree on exactly this progression and confirm it can be done per-target/per-module, leaving other targets in Swift 5 mode until ready ([useyourloaf.com](https://useyourloaf.com/blog/strict-concurrency-checking-in-swift-packages/), [avanderlee.com](https://www.avanderlee.com/concurrency/swift-6-migrating-xcode-projects-packages/), [donnywals.com](https://www.donnywals.com/how-to-plan-a-migration-to-swift-6/)). HIGH confidence on the general shape; MEDIUM on specifics since I could not pull Apple's canonical strict-concurrency-migration doc content directly (fetch returned no body — verify against `developer.apple.com/documentation/swift/updating-an-app-to-use-strict-concurrency` yourself before relying on any detail not corroborated below).

### Can the package and the app be on different language modes simultaneously? Yes — that's the intended mechanism, not a workaround

Language mode is a per-target compiler setting, not an ABI or linkage boundary; Swift 6-mode targets and Swift 5-mode targets build and link together normally in the same Xcode project. This is explicitly the recommended incremental strategy, not a hack (HIGH — corroborated by Apple's per-target design and every migration guide found).

What actually breaks if they diverge: **not build breakage, but where the errors surface.** Once `RawkoonKit` is Swift 6/Sendable-clean, its public API is safe to consume from the app regardless of the app's own language mode. But if you migrate in the other order — app to `.v6` while `RawkoonKit` is still pinned `.v5` with no strict-concurrency checking — any non-`Sendable` type or unisolated global `RawkoonKit` exposes becomes a data-race diagnostic *in the app*, at every call site, with no indication the root cause is upstream. The audit already notes this is a non-issue here ("value types are already `Sendable` across the API boundary"), which is exactly why doing `RawkoonKit` first removes the risk entirely rather than requiring a temporary `@preconcurrency import RawkoonKit` in the app while the package catches up.

### `project.yml` settings, by phase

```yaml
# Phase A: targeted checking, still Swift 5 language mode
settings:
  base:
    SWIFT_VERSION: "5.0"
    SWIFT_STRICT_CONCURRENCY: targeted

# Phase B: complete checking, still Swift 5 language mode
settings:
  base:
    SWIFT_VERSION: "5.0"
    SWIFT_STRICT_CONCURRENCY: complete

# Phase C: Swift 6 language mode (complete checking becomes errors, not warnings;
# SWIFT_STRICT_CONCURRENCY is meaningless once SWIFT_VERSION = 6.0 and can be removed)
settings:
  base:
    SWIFT_VERSION: "6.0"
```

`SWIFT_STRICT_CONCURRENCY` has three levels — `minimal` (Swift 5 default, essentially off), `targeted` (checks only code that already touches concurrency — actors, `async`, `@MainActor`), `complete` (full Swift 6-style checking, but still emitted as warnings under language mode 5) ([avanderlee.com](https://www.avanderlee.com/concurrency/swift-6-migrating-xcode-projects-packages/), [donnywals.com](https://www.donnywals.com/how-to-plan-a-migration-to-swift-6/)). HIGH confidence — this is standard, widely corroborated Xcode 16+/26 behavior.

### `Package.swift` settings, by phase

`RawkoonKit`'s `swift-tools-version: 6.0` already implies the newer manifest API. Given the recommendation above (skip straight to `.v6` for this package), the two states you actually need are:

```swift
// Current (today)
.target(name: "RawkoonKit", swiftSettings: [.swiftLanguageMode(.v5)]),

// Target state
.target(name: "RawkoonKit"),   // .swiftLanguageMode(.v6) is the default once tools-version is 6.0 and no override is present
```

Mirror the same change on `RawkoonKitTests`. If you decide you want incremental warnings-first feedback before flipping the whole package (e.g. if the actual fix set turns out larger than expected), the interim step is `.enableUpcomingFeature("StrictConcurrency")` alongside the `.v5` pin — but note this flag predates `swift-tools-version: 6.0` packages and its exact interaction with an already-6.0-tools-version manifest that explicitly pins `.v5` is not something I could verify with certainty (LOW confidence on this specific interim step only — verify with `swift build -Xswiftc -strict-concurrency=complete` locally before committing to it as a phase). Given RawkoonKit's small size, the pragmatic recommendation stands: skip this interim step and go straight to `.v6`.

### `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` — what it does, and the right call for each target

SE-0466 ("Control Default Actor Isolation Inference"), shipped in Swift 6.2, lets a module set its *default* isolation to `MainActor` instead of `nonisolated`. Set via the build setting `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` in Xcode, or `defaultIsolation(MainActor.self)` in `Package.swift` (`SwiftSetting` API). With it on, every type, function, and property in that module that isn't otherwise annotated is implicitly `@MainActor` — code that never explicitly introduces concurrency behaves as effectively single-threaded, which is exactly this app's shape (SwiftUI, `AppModel` already `@MainActor`, all UI-thread-driven). Xcode 26's *new-project* templates turn this on by default alongside `SWIFT_APPROACHABLE_CONCURRENCY = YES` (SE-0466 + SE-0461 bundled), but this is an XcodeGen-generated project targeting iOS 18, not a fresh Xcode 26 template, so it must be set explicitly — it is not inherited automatically. (HIGH confidence — SE-0466 status is "Implemented (Swift 6.2)"; [swift-evolution/0466](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md), [avanderlee.com](https://www.avanderlee.com/concurrency/default-actor-isolation-in-swift-6-2/).)

**Set it on the `Rawkoon` app target. Do not set it on `RawkoonKit`.** SE-0466's own motivation text calls out exactly this split: `MainActor`-by-default is the wrong choice "for many kinds of modules, including libraries that offer APIs that can be used from any isolation domain" — which is precisely what `RawkoonKit` is (pure logic, consumed from wherever the app happens to call it, tested on Linux with no `MainActor` runtime at all). Defaulting it to `MainActor` would force every one of its 72 tests and every non-UI call site to either run on the main actor or hop, for no benefit and real cost on the CI side. Leave `RawkoonKit`'s default isolation as `nonisolated` (the default default).

For the app target, the win: most of the "hand-maintained versions of what the compiler would check for free" the audit calls out — the `onMain(_:)` helper, ad hoc `Task { @MainActor in }` hops — become largely redundant for code that doesn't cross an actual isolation boundary, because the type system now agrees with what's already true at runtime. The cost: `APIClient` is already an `actor`, so it is unaffected (actors define their own isolation domain regardless of module default) — no free lunch there, and no harm either. The real cost surfaces if/when this codebase later adds genuine background work (e.g. bulk file I/O, image decoding) — under `MainActor`-by-default, a plain function silently *stays* on the main actor unless explicitly marked `nonisolated` or `@concurrent`, so a future contributor who wants real parallelism must opt in explicitly rather than opt out. That's a reasonable tradeoff for an app this size, but it should be a deliberate decision recorded as a `Key Decision` in `PROJECT.md`, not a default nobody chose.

---

## 2. AVFoundation/MediaPlayer pitfalls, construct by construct

The single most useful fact for this whole section: **`AVQueuePlayer`, `AVPlayerItem`, and `MPRemoteCommandEvent` are not `Sendable`, and nothing in the iOS 26 SDK marks them so.** I could not find any SDK release note or changelog claiming AVFoundation/MediaPlayer classes gained `Sendable` conformance (LOW-MEDIUM confidence on the *absence* — a negative claim from search coverage rather than a direct source read of the SDK headers; if you want certainty, `grep -r "Sendable" $(xcrun --sdk iphoneos --show-sdk-path)/System/Library/Frameworks/{AVFoundation,MediaPlayer}.framework` on the macbuild host before relying on it). Treat every AVFoundation/MediaPlayer reference type as non-`Sendable` for this whole migration. That has a direct, useful consequence below: **the fix pattern differs depending on whether an AVFoundation object itself needs to cross the boundary, or only your own state does.**

Also load-bearing: marking `final class AudiobookPlayer: ObservableObject` as `@MainActor` makes it implicitly `Sendable` for free — a `MainActor`-isolated class is automatically `Sendable` because all its mutable state is isolated to one actor (this is why `massicotte.org`'s "Redundant Sendable conformances" note singles out global-actor-isolated types as already `Sendable`). That resolves every `[weak self]` capture crossing a `Task`/GCD boundary in this file without any extra annotation. It does **not** resolve captures of `AVPlayerItem`/`AVQueuePlayer` themselves — those need per-site handling, covered below.

### NotificationCenter observers that must touch main-actor state

**Applies to:** `interruptionObserver` (lines 132–138), `resetObserver` (144–150), and `endObserver` (688–701).

All three are registered with `queue: .main` (`OperationQueue.main`), which is an Apple-documented contract: passing `.main` guarantees the block runs on the main queue. That contract is exactly what `MainActor.assumeIsolated` exists to encode — it is a hard runtime check ("behaves exactly like a `precondition`... crashes at runtime in both debug and release if the assumption is wrong") that tells the compiler "trust me, I am statically certain this runs on the main actor," backed by the SDK's own guarantee, not a guess (HIGH confidence — [developer.apple.com/.../mainactor/assumeisolated](https://developer.apple.com/documentation/swift/mainactor/assumeisolated(_:file:line:)), [fatbobman.com](https://fatbobman.com/en/posts/mainactor-assumeisolated/)).

```swift
// Before (compiles today under Swift 5; will be a strict-concurrency error under .v6
// once AudiobookPlayer is @MainActor, because the closure signature is a plain
// nonisolated, non-@Sendable-checked () -> Void as far as the compiler is concerned):
interruptionObserver = center.addObserver(
    forName: AVAudioSession.interruptionNotification,
    object: session,
    queue: .main
) { [weak self] notification in
    self?.handleInterruption(notification)
}

// After — same synchronous call, same call frame, zero added latency:
interruptionObserver = center.addObserver(
    forName: AVAudioSession.interruptionNotification,
    object: session,
    queue: .main
) { [weak self] notification in
    MainActor.assumeIsolated {
        self?.handleInterruption(notification)
    }
}
```

Apply the identical transformation to `resetObserver` and to `endObserver` (the latter also reads `self.itemChapters` before calling `handleCurrentItemChanged()` — that read must be *inside* the `assumeIsolated` closure too, not before it).

**Do not** reach for `Task { @MainActor in ... }` here even though it's the pattern most blog posts suggest first for "fixing" this warning — see §3 for why that specifically breaks the interruption-resume behavior this file exists to get right.

### MPRemoteCommandCenter handlers that must return synchronously

**Applies to:** `onMain(_:)` (920–927) and every `addTarget` call in `configureRemoteCommands()` (968–1001).

Apple does not officially document which queue delivers `MPRemoteCommandCenter` handlers, but the file's own existing comment ("`MPRemoteCommandCenter` invokes handlers on its own queue") reflects consistent, widely-reported community observation across years of forum threads and sample code — treat it as *not guaranteed main*, which is exactly what today's `onMain` already assumes via its `Thread.isMainThread` branch (MEDIUM confidence — no single authoritative Apple statement found, but the code's existing defensive assumption matches every external report and is the safer of the two possible assumptions regardless).

Because the queue isn't guaranteed, `MainActor.assumeIsolated` is **not** safe to use unconditionally here — unlike the `queue: .main` NotificationCenter observers above, there is no SDK contract to lean on, and an unconditional `assumeIsolated` would crash exactly when the handler fires off-main, which by report happens. The correct fix preserves the existing hybrid shape and just makes the types line up:

```swift
// Before:
private func onMain(_ work: @escaping () -> Void) -> MPRemoteCommandHandlerStatus {
    if Thread.isMainThread {
        work()
    } else {
        DispatchQueue.main.async(execute: work)
    }
    return .success
}

// After — the parameter becomes @MainActor so call sites like
// `self?.onMain { self?.play() }` typecheck (the closure literal is now
// checked as MainActor-isolated code, which is what it actually is),
// and the two branches each supply the isolation proof appropriate to
// what's actually known at that point:
private func onMain(_ work: @escaping @MainActor () -> Void) -> MPRemoteCommandHandlerStatus {
    if Thread.isMainThread {
        MainActor.assumeIsolated(work)
    } else {
        Task { @MainActor in work() }
    }
    return .success
}
```

This is a pattern I'm synthesizing for this exact file rather than quoting from a source — the general technique (a `@MainActor`-typed closure parameter bridging a legacy synchronous-callback API, combined with `assumeIsolated` for the "known main" branch) is well-established for exactly this class of problem ([fatbobman.com — "Using MainActor.assumeIsolated to Solve Legacy API Compatibility"](https://fatbobman.com/en/posts/mainactor-assumeisolated/)), but its specific application to `MPRemoteCommandCenter.addTarget` is my own extension of that pattern (LOW-MEDIUM — verify it actually compiles clean under `SWIFT_STRICT_CONCURRENCY = complete` before trusting it; if the `@MainActor` closure-parameter approach doesn't satisfy the compiler for a plain (non-`@Sendable`) `@escaping` closure type coming from an Objective-C `addTarget(handler:)` signature, the fallback is `nonisolated(unsafe) let onMainWork = work` immediately followed by the same two branches — see §3 for why that's the *acceptable, narrow* use of `nonisolated(unsafe)` here, not a red flag).

Critically, **the observable behavior of `onMain` must not change**: synchronous execution (and thus a `.success` that's already true by the time it's returned) when already on main, fire-and-forget async dispatch otherwise. See §3 for the concrete regression a "cleaner-looking" rewrite introduces.

### The `NSKeyValueObservation` block-based observers

**Applies to:** `currentItemObserver` (684–686) and `itemStatusObserver` (591–605).

These two are *not* interchangeable under strict concurrency, because they carry different threading guarantees, and the file already (correctly) treats them differently:

- `currentItemObserver = player.observe(\.currentItem, options: [.initial, .new]) { [weak self] _, _ in self?.handleCurrentItemChanged() }` — **passed no queue, and dispatches nothing itself.** This is the exact issue the audit calls out by name: "the known `currentItem` KVO has no queue, so it can touch `@Published` off main." KVO block observers fire synchronously on whatever thread mutates the observed property, and AVFoundation does not document `currentItem` changes as always landing on main. **Do not** "fix" this warning with `MainActor.assumeIsolated` — that would crash the app the first time this genuinely fires off-main, converting a latent bug into a guaranteed crash. It needs a real hop:
  ```swift
  currentItemObserver = player.observe(\.currentItem, options: [.initial, .new]) { [weak self] _, _ in
      DispatchQueue.main.async {
          self?.handleCurrentItemChanged()
      }
  }
  ```
  This *is* a behavior change from today (today it may run synchronously off-main, silently corrupting `@Published` state per the audit's own description — that's a bug, not a spec) — but it's the fix, not a regression, and it matches the pattern `itemStatusObserver` already uses below. Flag this specific site for extra manual QA on `macbuild`: chapter-boundary auto-advance and the "book finished" `AVPlayerItemDidPlayToEndTime` path both depend on `handleCurrentItemChanged` firing at the right moment relative to `isSeeking`/`seekID` state.

- `itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in DispatchQueue.main.async { ... switch item.status { ... } } }` — already defensively hops via `DispatchQueue.main.async`, which is right (item `status` KVO is likewise not documented as main-thread-only). But there's a second, separate problem here Swift 6 will actually catch: `DispatchQueue.async(execute:)`'s closure parameter is `@Sendable`, and this closure captures `item` — an `AVPlayerItem`, a non-`Sendable` reference type — across that boundary. This is a genuine "capture of non-Sendable type in `@Sendable` closure" diagnostic, not a false positive: `AVPlayerItem.status` really can be mutated by AVFoundation's internal machinery between the moment the KVO block captures `item` and the moment the dispatched block reads `item.status` on main. The fix is to snapshot the one `Sendable` value you actually need *inside the synchronous KVO callback*, before crossing the boundary, and never carry the item reference across:
  ```swift
  // Before:
  itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
      DispatchQueue.main.async {
          guard let self, self.seekID == id else { return }
          switch item.status {
          case .readyToPlay: ...
          case .failed: ...
          default: break
          }
      }
  }

  // After — status (an enum, trivially Sendable) is read synchronously at
  // KVO-fire time and only that value crosses the boundary:
  itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
      let status = item.status
      DispatchQueue.main.async {
          guard let self, self.seekID == id else { return }
          switch status {
          case .readyToPlay: ...
          case .failed: ...
          default: break
          }
      }
  }
  ```
  This preserves identical semantics (same status value, same instant it's read) while being provably race-free, which is strictly better than the status quo, not just compiler-quiet. (This specific fix is my synthesis applied to this file, grounded in well-established Sendable-closure-capture rules — HIGH confidence on the mechanism, LOW-MEDIUM on it being *the* idiomatic answer versus an equally valid alternative such as switching this whole observer to Swift 6.2's newer async KVO surface, which is out of scope here since it likely requires an iOS 26 floor — see the `NotificationCenter.Message` note below for why that ceiling applies broadly in this codebase.)

### The periodic time observer's `queue:` parameter and closure isolation

**Applies to:** `timeObserver` (677–682).

`player.addPeriodicTimeObserver(forInterval:queue:using:)` is documented by Apple: passing `.main` guarantees the block executes on the main queue (the same contract as `NotificationCenter`'s `queue:` parameter, and the same one this file already leans on by passing `.main` explicitly). Same fix as the NotificationCenter observers:

```swift
timeObserver = player.addPeriodicTimeObserver(
    forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
    queue: .main
) { [weak self] time in
    MainActor.assumeIsolated {
        self?.handleTick(time.seconds)
    }
}
```

`time: CMTime` crossing the closure boundary is not a concern — `CMTime` is a plain C-style value struct (value/timescale/flags/epoch, all trivial value types), and Swift synthesizes `Sendable` automatically for structs whose stored properties are all `Sendable`. (MEDIUM-HIGH — I did not find an explicit "CMTime is Sendable" statement in Apple docs, but this follows directly from CMTime's known shape and Swift's synthesis rules; verify with a build rather than treating it as certain.)

Contrast with the `seek(to:toleranceBefore:toleranceAfter:completionHandler:)` completion at line 552: **that** completion handler's queue is *not* documented as main (arbitrary queue), which is exactly why the existing code already wraps it in `DispatchQueue.main.async` (line 553) rather than calling straight through. Keep that hop as-is; just wrap its body in `MainActor.assumeIsolated` once inside the `DispatchQueue.main.async` block (since `DispatchQueue.main.async` itself does not prove main-actor isolation to the compiler, even though it does guarantee main-thread execution at runtime — these are two different facts and Swift 6 only cares about the first one). The `finished: Bool` and `id: Int` values captured here are trivially `Sendable`; no further changes needed.

### The `NotificationCenter.Message` iOS 26 API is not usable here — deployment target ceiling

Swift 6.2 introduced concurrency-native `NotificationCenter.MainActorMessage`/`AsyncMessage` protocols that sidestep the whole "is `Notification` `Sendable`" problem cleanly (a `Notification` genuinely cannot be `Sendable` — it carries arbitrary `object`/`userInfo` references). **These require macOS 26 / iOS 26 as the availability floor** — they ship in Foundation, not the language, so they are gated by OS version regardless of the Swift toolchain used to build (HIGH confidence — [avanderlee.com](https://www.avanderlee.com/concurrency/mainactormessage-asyncmessage-concurrency-safe-notifications/), [fatbobman.com](https://fatbobman.com/en/posts/notificationcentermessage-a-new-concurrency-safe-notification-experience-in-swift-62/)). This app's deployment target is iOS 18. Do not consider this API for this milestone; the `MainActor.assumeIsolated`-wrapped closure-based `addObserver` pattern above is the correct and only option at this deployment target.

---

## 3. Traps that produce silent behavior change

This is the section that matters most given three consecutive releases (v1.12.4–v1.12.6) each introduced a bug while fixing the previous one. The common thread in every trap below: **a construct that looks like a mechanical "make the compiler happy" rewrite actually changes *when* code runs, not just *how the compiler proves it's safe*.**

### Trap: `Task { @MainActor in }` as the default answer to every isolation warning

This is the single highest-risk anti-pattern for this file, because it is also the single most commonly recommended "just fix it" answer in Swift 6 migration blog posts — and it is wrong for every synchronous SDK callback in this file that carries a threading guarantee (`queue: .main` observers, the periodic time observer).

**Concrete example — interruption handling (the exact area v1.12.6 was shipped to fix):**

```swift
// WRONG — compiles, "fixes" the warning, silently reorders event handling:
interruptionObserver = center.addObserver(
    forName: AVAudioSession.interruptionNotification,
    object: session, queue: .main
) { [weak self] notification in
    Task { @MainActor in
        self?.handleInterruption(notification)
    }
}
```

Today, `handleInterruption` runs synchronously, in the same call frame, the instant the OS delivers the notification on the main queue — meaning it runs strictly before anything else that gets queued onto the main run loop afterward (a periodic tick, a KVO callback, a SwiftUI update). Wrapping it in `Task { @MainActor in ... }` schedules it as a *separate* unit of main-actor work instead of running it inline; Swift's cooperative scheduler does not guarantee it runs before other main-actor work queued in between, only that it eventually runs on the main actor. For interruption handling specifically — where `.began` can be followed by `.ended(shouldResume:)` in very close succession (the Maps-prompt scenario this exact file's comments describe at length) — this reintroduces a race between `wasPlayingBeforeInterruption` being read/written by two handler invocations and the ordering guarantee the whole `InterruptionState`/`interruptionDecision` design in `RawkoonKit` depends on. The correct fix is the `MainActor.assumeIsolated` form in §2, which preserves the exact synchronous, in-order execution that exists today.

**Concrete example — the play/pause remote command (the "matters enormously" case named in the brief):**

```swift
// WRONG:
private func onMain(_ work: @escaping @MainActor () -> Void) -> MPRemoteCommandHandlerStatus {
    Task { @MainActor in work() }
    return .success
}
```

Today, when a command handler fires on the main thread (the common case for standard transport commands per community reports), `pause()`/`play()` runs to completion — including the `isPlaying` mutation and the Now Playing info update — *before* `onMain` returns `.success` to the command center. With the all-`Task` rewrite, `.success` is returned immediately while the actual work is merely scheduled. A rapid double-press of a steering-wheel or headset toggle button (which sends `togglePlayPauseCommand` twice in quick succession) can now race: the second press's handler reads `self.isPlaying` before the first press's `Task` has run and mutated it, so both presses compute the same action instead of alternating — the toggle silently does nothing on a double-tap. This is exactly the shape of bug the project's own history warns about, and it would not show up in any test that isn't a real device with a real remote control. Use the hybrid form in §2 instead — synchronous via `MainActor.assumeIsolated` when already on main, `Task { @MainActor in }` only for the genuinely-off-main branch (where there is no synchronous alternative and no prior guarantee to preserve).

**When `Task { @MainActor in }` *is* the right answer here:** anywhere the current code is *already* asynchronous and has no ordering guarantee to preserve — e.g. `loadArtwork`'s existing `Task { ... await MainActor.run { ... } } }` (877–897) is already fire-and-forget relative to everything else; converting `await MainActor.run { }` to a plain `@MainActor` closure body or leaving it as-is is a no-op change, not a hazard. The distinguishing question to ask at every site: **"does removing the synchronous guarantee here change what could interleave with what?"** If yes, `assumeIsolated`. If the code was already async/deferred, `Task { @MainActor }` is fine.

### Trap: `@unchecked Sendable` as a warning-suppressor

Anti-pattern: wrapping a captured `AVPlayerItem` in a throwaway `@unchecked Sendable` box to silence the `itemStatusObserver` capture warning (§2) instead of extracting the `Sendable` value:

```swift
// WRONG — suppresses the diagnostic without removing the actual race:
final class UncheckedBox<T>: @unchecked Sendable { let value: T; init(_ value: T) { self.value = value } }

itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
    let box = UncheckedBox(item)
    DispatchQueue.main.async {
        switch box.value.status { ... }   // still reads item.status on a delay, still racy
    }
}
```

This compiles clean and looks like a fix, but it does nothing to address the actual hazard the compiler found: `item.status` can still change between capture and read, because the underlying reference — not a snapshot — is what's being carried across the boundary. `@unchecked Sendable` is a promise to the compiler that *you* have verified thread-safety by some means it can't see (e.g., a type with its own internal lock) — it is not a promise that data races are impossible, and here nothing was actually verified. Use it only when you can point to the specific synchronization mechanism that makes the unchecked promise true (rare in this file — `APIClient` being an `actor` already means it never needs this). The right fix for `itemStatusObserver` is the value-extraction shown in §2, which removes the race rather than hiding it.

### Trap: `nonisolated(unsafe)` used broadly instead of narrowly

`nonisolated(unsafe)` is legitimate for exactly one shape of problem in this file: a stored property that is only ever mutated on one thread by convention the compiler can't prove, and where converting it to a `Task` hop would be a bigger behavior change than trusting the existing convention. `commandTargets: [(command: MPRemoteCommand, target: Any)]` (line 37) and the `deinit`'s cleanup loop over it (65–82) are one plausible candidate: `deinit` in Swift runs in a nonisolated context regardless of the class's own actor, so if `AudiobookPlayer` becomes `@MainActor`, `deinit` cannot synchronously touch `commandTargets` (a `@MainActor`-isolated stored property) without an isolation proof, and `deinit` cannot be `async`. Since `command.removeTarget(entry.target)` and `NotificationCenter.default.removeObserver(observer)` are plain synchronous Foundation/MediaPlayer calls with no actor affinity of their own, marking `commandTargets`, `timeObserver`, `endObserver`, `currentItemObserver`, `itemStatusObserver`, `interruptionObserver`, and `resetObserver` as `nonisolated(unsafe)` — matching how the property is already used (write-once at setup, read-once at teardown, never concurrently) — is a defensible, narrow use, **provided `deinit` is the only nonisolated reader/writer left** once the rest of the migration marks everything else `@MainActor`. Do not reach for `nonisolated(unsafe)` on properties that participate in the play/pause/seek state machine (`isPlaying`, `positionSecs`, `isSeeking`, `seekID`, `pausedAt`, `wasPlayingBeforeInterruption`) — those are exactly the properties strict concurrency exists to protect, and unsafely opting them out defeats the entire point of this milestone's CONC-01 item.

### Trap: `assumeIsolated` used where the SDK gives no threading guarantee

Covered in §2 (`currentItemObserver`, `itemStatusObserver`, `MPRemoteCommandCenter` handlers) — repeating here because it's the inverse of the `Task {}` trap and equally dangerous: using `assumeIsolated` *feels* like the more "correct," "modern" answer (no dispatch overhead, no reordering) precisely in the cases where it's actually unsafe, because those are the cases without a documented threading contract to lean on. The rule that generalizes across this whole file: **`assumeIsolated` is only ever correct at a site where an Apple API contractually guarantees main-thread/main-queue delivery** (`queue: .main` passed explicitly to `NotificationCenter.addObserver` or `addPeriodicTimeObserver`). Everywhere else — undocumented KVO delivery threads, undocumented `MPRemoteCommandCenter` queues, undocumented completion-handler queues — hop for real.

---

## 4. `@preconcurrency import` and Readium 3.11.0

`@preconcurrency import X` tells the compiler to trust `X`'s pre-Swift-6 API surface without applying `Sendable`/isolation checking to types crossing from `X` into your code, as a deliberate, temporary, revisitable escape hatch for consuming a dependency that hasn't migrated yet ([avanderlee.com](https://www.avanderlee.com/concurrency/preconcurrency-checking-swift/), [donnywals.com](https://www.donnywals.com/preconcurrency-usage-in-swift-explained/)). It's legitimate exactly when: (a) the dependency is out of your control (a third-party SPM package, as here), (b) it predates Swift 6 strict concurrency in its own build, and (c) you plan to remove the attribute once the dependency catches up — Swift will itself tell you when it's become a no-op (a "unnecessary `@preconcurrency`" warning once the imported module's API is actually already `Sendable`-clean).

**Readium 3.11.0 — the version this project is pinned to per `project.yml` and per the `PROJECT.md` "Replacing... Readium" out-of-scope note — almost certainly needs it.** I checked the Readium `swift-toolkit` changelog directly: **3.11.0 was released 2026-07-17 with no mention of Swift 6, `Sendable`, or concurrency work.** The toolkit's actual Swift 6 migration — "migrated to Swift 6 with strict concurrency checking, all packages compile in the Swift 6 language mode," core types (`Publication`, `Resource`, `Container`, etc.) becoming `Sendable`, `Navigator`/`VisualNavigator` and their delegates becoming `@MainActor` — landed in **4.0.0-alpha.1, released 2026-08-14**, about a month after 3.11.0 (MEDIUM confidence — read directly off the project's own CHANGELOG.md via GitHub fetch, not secondary reporting, but I could not independently cross-check the dates against a second source). Since `PROJECT.md` explicitly rules out a Readium version bump for this milestone ("Replacing Readium... all three work and all three were expensive to get right"), the app is stuck importing a pre-Swift-6 Readium indefinitely for this milestone's duration.

Practical guidance: expect `@preconcurrency import ReadiumShared`, `@preconcurrency import ReadiumStreamer`, and `@preconcurrency import ReadiumNavigator` to be necessary once the app target reaches `SWIFT_STRICT_CONCURRENCY = complete` or `.v6`, wherever the app touches Readium's `Navigator`/`VisualNavigator` protocols or their delegate callbacks (the ebook-reading surface — `BookView` per the audit, not `AudiobookPlayer.swift`, which has no Readium dependency at all). Add the attribute at the specific `import` sites that actually produce diagnostics rather than pre-emptively on every Readium import — that keeps the "remove once fixed" signal meaningful per-file instead of blanket-suppressed. Do not treat this as license to skip fixing genuine app-side `Sendable` issues in the ebook-reading code; `@preconcurrency` only suppresses diagnostics *about Readium's own unmarked API surface*, not about how the app's own delegate implementations or closures handle Readium's callbacks.

---

## Phase-Specific Warnings

| Phase / area | Likely pitfall | Mitigation |
|---|---|---|
| `RawkoonKit` → `.v6` | Low risk — pure logic, fast Linux CI signal | Go straight to `.v6`, skip the targeted/complete crawl |
| App target: targeted checking | `Sendable` warnings on `RawkoonKit` types if migrated after the package — should be none if package goes first | Migrate `RawkoonKit` before the app target |
| App target: complete checking, `AudiobookPlayer.swift` | Every construct in §2 surfaces a diagnostic at once — this is the file that needs a dedicated review pass, not a drive-by fix | Work through §2 construct-by-construct; get an explicit macbuild device-test pass on interruption handling and remote-command double-tap before merging |
| App target: complete checking, ebook reader (`BookView`, Readium delegates) | Readium 3.11.0 pre-Swift-6 API surface | `@preconcurrency import` at the specific Readium import sites that fail (§4) |
| Enabling `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` | Applying it to `RawkoonKit` by copy-paste from the app target's settings | Restrict to the `Rawkoon` app target only; leave `RawkoonKit`'s default isolation `nonisolated` |
| Any "fix the warning" pass on `AudiobookPlayer.swift` | `Task { @MainActor in }` substituted for a synchronous, ordering-dependent callback (§3) | For every `queue: .main`-guaranteed callback, use `MainActor.assumeIsolated`, not `Task` |
| Any "fix the warning" pass on `AudiobookPlayer.swift` | `@unchecked Sendable` / `nonisolated(unsafe)` used to silence a real KVO race (`itemStatusObserver`) instead of extracting a `Sendable` snapshot | Snapshot the needed value inside the synchronous callback before it crosses the boundary (§2, §3) |
| `MPRemoteCommandCenter` handlers specifically | The double-tap/toggle race described in §3 is untestable by unit test | Manual macbuild verification with a real double-press on a paired headset/CarPlay simulator before considering this construct done |

## Gaps / things to verify directly rather than trust this document

- The exact `Package.swift` interaction between `.enableUpcomingFeature("StrictConcurrency")` and an already-`swift-tools-version: 6.0` manifest pinned to `.swiftLanguageMode(.v5)` — recommend skipping this interim step for `RawkoonKit` given its size, per §1.
- Whether AVFoundation/MediaPlayer classes gained any `Sendable`/`@preconcurrency` markup specifically in the iOS 26 SDK — I could not confirm or rule this out from search alone; a `grep -r "Sendable"` over the SDK framework headers on `macbuild` would settle it definitively before the migration starts.
- The precise `MPRemoteCommandCenter` handler-callback queue is nowhere officially documented by Apple in anything I could retrieve — treat every claim about it (including this file's own code comment) as community-observed behavior, not a contract, and keep the defensive `Thread.isMainThread` check regardless of what the migration does elsewhere.
- Apple's own "Updating an app to use strict concurrency" doc page would not return body content through the fetch tool used here — read it directly before finalizing the phase plan, since it is the single most authoritative source for §1 and returned nothing verifiable in this research pass.

## Sources

- [SE-0466: Control Default Actor Isolation Inference](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md) — HIGH
- [`MainActor.assumeIsolated(_:file:line:)` — Apple Developer Documentation](https://developer.apple.com/documentation/swift/mainactor/assumeisolated(_:file:line:)) — HIGH
- [Default Actor Isolation in Swift 6.2 — SwiftLee (avanderlee.com)](https://www.avanderlee.com/concurrency/default-actor-isolation-in-swift-6-2/) — MEDIUM-HIGH
- [Swift 6: What's New and How to Migrate — SwiftLee](https://www.avanderlee.com/concurrency/swift-6-migrating-xcode-projects-packages/) — MEDIUM-HIGH
- [Should you opt-in to Swift 6.2's Main Actor isolation? — donnywals.com](https://www.donnywals.com/should-you-opt-in-to-swift-6-2s-main-actor-isolation/) — MEDIUM
- [How to plan a migration to Swift 6 — donnywals.com](https://www.donnywals.com/how-to-plan-a-migration-to-swift-6/) — MEDIUM
- [Strict Concurrency Checking in Swift Packages — useyourloaf.com](https://useyourloaf.com/blog/strict-concurrency-checking-in-swift-packages/) — MEDIUM
- [Problematic Swift Concurrency Patterns — massicotte.org](https://www.massicotte.org/problematic-patterns/) — MEDIUM-HIGH
- [Using MainActor.assumeIsolated to Solve Legacy API Compatibility — fatbobman.com](https://fatbobman.com/en/posts/mainactor-assumeisolated/) — MEDIUM-HIGH
- [NotificationCenter.Message — A New Concurrency-Safe Notification Experience in Swift 6.2 — fatbobman.com](https://fatbobman.com/en/posts/notificationcentermessage-a-new-concurrency-safe-notification-experience-in-swift-62/) — MEDIUM-HIGH
- [MainActorMessage & AsyncMessage: Concurrency-safe notifications — SwiftLee](https://www.avanderlee.com/concurrency/mainactormessage-asyncmessage-concurrency-safe-notifications/) — MEDIUM-HIGH
- [@preconcurrency: Incremental migration to concurrency checking — SwiftLee](https://www.avanderlee.com/concurrency/preconcurrency-checking-swift/) — MEDIUM-HIGH
- [@preconcurrency usage in Swift explained — donnywals.com](https://www.donnywals.com/preconcurrency-usage-in-swift-explained/) — MEDIUM
- [readium/swift-toolkit — CHANGELOG.md](https://github.com/readium/swift-toolkit/blob/develop/CHANGELOG.md) — MEDIUM (primary source, single fetch, dates not cross-checked against a second source)
- [readium/swift-toolkit — Migration Guide.md](https://github.com/readium/swift-toolkit/blob/develop/docs/Migration%20Guide.md) — MEDIUM
- Apple's "Updating an app to use strict concurrency" doc page — attempted, returned no retrievable body content; **not relied on for any specific claim in this document**
