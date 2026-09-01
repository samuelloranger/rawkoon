# Architecture Research: ObservableObject → @Observable and View-Model Extraction

**Domain:** SwiftUI structural refactor of an existing shipping app (rawkoon iOS,
Xcode 26, iOS 18 deployment target)
**Researched:** 2026-09-01
**Scope:** OBS-01, VM-01, API-01 from `apps/ios/docs/code-quality-audit.md`.
Swift 6 strict concurrency (CONC-01) is explicitly out of scope — covered by
another researcher — but is referenced where it changes the safe *order* of
work.

## Executive summary

This app has three `ObservableObject`s — `AppModel` (`Rawkoon/AppModel.swift`),
`AudiobookPlayer` (`Rawkoon/AudiobookPlayer.swift`), and a small private
`ReaderChrome` inside `Views/EbookReaderView.swift` — and 21 view files that
consume `AppModel` via `@EnvironmentObject`, plus 11 `.environmentObject(model)`
injection sites across 5 files. The `@Observable` migration is mechanical and
compiler-checked (`@EnvironmentObject` on an `@Observable` type simply fails to
build), with exactly one non-mechanical decision: what replaces
`AppModel.bindPlayer()`'s Combine pipeline over `player.$isPlaying` /
`player.objectWillChange`. That pipeline should be deleted and replaced with
explicit callbacks from `AudiobookPlayer`, not with `withObservationTracking`
— Observation's tracking primitive is built for view re-rendering, not
model-to-model side effects, and has a documented one-shot re-registration
gotcha that makes it a worse fit here than a plain closure.

`MediaDetailView`'s 1,443 lines and 34 `@State` properties split cleanly along
one line: state that exists because of a network call, a retry, or a
cross-screen mutation (26 of the 34) belongs in a new `MediaDetailViewModel`;
state that exists only to drive a sheet, a disclosure triangle, or a
navigation push (8 of the 34) stays `@State` in the view. The judgment call is
narrow protocols per view model against `APIClient`'s ~70 methods, not one
`APIClientProtocol` mirroring the whole actor — and it pairs naturally with
API-01 (splitting `APIClient` into domain extensions), which is why the
audit's own ordering puts the actor split immediately before the view-model
extraction.

Ordering: do OBS-01 before VM-01, which is what the audit and `PROJECT.md`
already decided — this document explains *why*, grounded in this codebase's
actual coupling (`bindPlayer()`, `MiniPlayerView.body` calling
`model.activeBook()`), not just general preference.

---

## 1. `ObservableObject` → `@Observable`: exact mechanics for this codebase

### Call-site substitution table

| Old | New | Where it appears here |
|---|---|---|
| `final class X: ObservableObject { @Published var y }` | `@Observable final class X { var y }` | `AppModel`, `AudiobookPlayer`, `ReaderChrome` |
| `@StateObject private var model = AppModel.shared` | `@State private var model = AppModel.shared` | `RawkoonApp.swift:7` |
| `.environmentObject(model)` | `.environment(model)` | `RawkoonApp.swift`, `MediaDetailView.swift` (×2, for `ReleaseSearchView` sheets), `LibraryView.swift`, `ContinueListeningView.swift`, `BookView.swift` — 11 call sites total |
| `@EnvironmentObject private var model: AppModel` | `@Environment(AppModel.self) private var model` | 21 view files (grep count) |
| `@ObservedObject var x: X` (not used here, but for completeness) | `let x: X` (no wrapper — `@Observable` composes automatically through plain references) | n/a in this codebase |
| `@StateObject private var chrome = ReaderChrome()` | `@State private var chrome = ReaderChrome()` | `EbookReaderView.swift:184` |

There is no `@ObservedObject` anywhere in `apps/ios` today (verified by grep),
so that row is included only because the question asks about it — it becomes
a bare `let` (or `var` if the view needs to replace the reference, which none
here do) because `@Observable` types need no property wrapper at all when
passed down as a parameter; SwiftUI tracks reads through plain references the
same way it tracks reads through `@State`/`@Environment`-held ones.

**Confidence: HIGH.** Confirmed against Apple's own migration guide summary
(the exact URL is `developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro`;
the fetch tool could not render its JS-driven body, so this is corroborated
via WebSearch snippets of that page plus multiple independent 2025/2026
write-ups that agree on every substitution above) and cross-checked against
three independent sources for the "`@StateObject`/`@ObservedObject`/
`@EnvironmentObject` do not accept `@Observable` types — this is a compile
error, not a silent behavior change" claim.

### `objectWillChange` — gone, and specifically why `bindPlayer()` goes with it

`@Observable` does **not** synthesize `objectWillChange`. There is no Combine
publisher at all unless you hand-roll one. Concretely for this codebase:

```swift
// AppModel.swift — bindPlayer(), current code
private func bindPlayer() {
    player.objectWillChange
        .sink { [weak self] _ in self?.objectWillChange.send() }
        .store(in: &cancellables)
    ...
}
```

This relay exists because, under `ObservableObject`, a view holding
`@EnvironmentObject var model: AppModel` only re-renders when `AppModel`
itself fires `objectWillChange` — and `AppModel` has no idea when its `player`
property's internals changed, so `AppModel` has to manually forward the
signal. **Under `@Observable`, this relay is structurally unnecessary and
should be deleted, not translated.** Observation tracks the *actual property
that was read*, anywhere in the object graph — a view that reads
`model.player.isPlaying` inside `body` is tracked on `isPlaying` on the
`player` instance directly, no matter how deep it sits under `model`. Nothing
has to "bubble up" a change notification through `AppModel` for that read to
invalidate the view. Delete the `player.objectWillChange.sink` block entirely.

**Confidence: HIGH** — this is the single most load-bearing, most concretely
verifiable claim in this document: Apple's WWDC23 "Discover Observation in
SwiftUI" session and the migration guide both describe per-property,
graph-deep tracking as the explicit reason `objectWillChange` relays like this
one become unneeded, and it is corroborated by every source consulted.

### `$isPlaying.sink` — no direct replacement; restructure to a push callback

This is the concrete case the task asked to answer, not hand-wave. Current
code:

```swift
// AppModel.swift — bindPlayer()
player.$positionSecs
    .sink { [weak self] _ in self?.persistPlaybackProgress(force: false) }
    .store(in: &cancellables)

player.$isPlaying
    .dropFirst()
    .removeDuplicates()
    .sink { [weak self] isPlaying in
        guard !isPlaying else { return }
        self?.persistPlaybackProgress(force: true)
    }
    .store(in: &cancellables)
```

`@Observable` gives you no `$property` publisher — `@Published` cannot
coexist with `@Observable` at all (the macro rejects it), and there is no
drop-in Combine equivalent. Apple's supplied primitive for observing a change
from *outside* a view is the free function `withObservationTracking(_:onChange:)`,
but it has a documented shape that makes it a poor fit for this exact
use case:

- It fires **once** per registration. To keep observing, the `onChange`
  closure has to re-call `withObservationTracking` on itself — a manual
  re-arming loop, easy to get wrong (miss a re-arm and silently stop
  persisting progress after the first tick).
- `onChange` fires at the point the mutation is about to apply, before the
  new value is necessarily visible to a synchronous read inside the closure —
  several independent write-ups note you must hop to a new `Task` to read the
  post-change value reliably, which is exactly the kind of subtlety this
  progress-persistence code cannot afford to get wrong silently.
- It is designed to drive a single derived reaction from a *render-adjacent*
  context (a view or a coordinator watching a view model). `AppModel` reacting
  to `AudiobookPlayer` is a **model-to-model** relationship, not a
  view-adjacent one — `withObservationTracking` was not built for continuous
  cross-model wiring, and every independent source consulted treats it as the
  exception mechanism, not the default one, for that case.

**Recommendation for this codebase:** replace the pull-based Combine
subscription with a push-based callback that `AudiobookPlayer` invokes
directly at its own mutation sites, mirroring the pattern the existing
`ChapterDownloader` completion closure in `AppModel.startDownload` already
uses (`{ [weak self] plan in Task { @MainActor in self?.applyDownloadPlan(...) } }`).
Concretely: give `AudiobookPlayer` a stored closure or a small delegate
protocol —

```swift
var onPositionChange: ((Double) -> Void)?
var onPlaybackStateChange: ((_ isPlaying: Bool) -> Void)?
```

— and call `onPositionChange?(clamped)` inside `handleTick(_:)` (where
`positionSecs` is already being written) and `onPlaybackStateChange?(isPlaying)`
at the couple of sites that flip `isPlaying` (`stopPlayback()`, `play()`,
`beginPlayback()`'s failure paths). `AppModel.bindPlayer()` becomes two
closure assignments instead of two Combine subscriptions, `cancellables`
disappears entirely, and the `dropFirst().removeDuplicates()` logic in the
old sink (needed only because Combine re-delivers the current value on
subscribe and can deliver duplicates) is no longer needed — a plain callback
never fires the "already true" case that `removeDuplicates()` existed to
suppress.

**This is the one item in OBS-01 that needs judgment, not mechanical
substitution** — flag it as its own review point when planning the phase.

**Confidence: MEDIUM-HIGH.** The "no `$property` publisher, no `@Published`
coexistence, `withObservationTracking` is one-shot and render-adjacent" facts
are corroborated by three independent 2025 sources (fatbobman.com's
Observation deep dive, donnywals.com's "Observing properties on an
`@Observable` class outside of SwiftUI views", and polpiella.dev). The
specific recommendation to replace with a push callback rather than
`withObservationTracking` is this document's synthesis, grounded in the
codebase's own existing callback-closure pattern for `ChapterDownloader` —
labelled as a recommendation, not a documented Apple mandate.

### `private(set)` and computed properties under the macro

- **`private(set) var x: T`** (stored): the macro still instruments it —
  external code can read it (and that read is tracked, exactly like a
  `@Published private(set)` was observed today) but cannot write it from
  outside the type. No annotation needed; this is a straight drop of
  `@Published`, keeping `private(set)`. Every `@Published private(set)` in
  `AudiobookPlayer` (`positionSecs`, `isPlaying`, `currentChapterIndex`,
  `currentChapter`, `rate`, `duration`, `sleepMode`, `sleepRemainingSecs`) and
  in `AppModel` (`isOnline`) becomes `private(set) var` with `@Published`
  simply deleted.
- **Computed properties** (`var x: T { ... }`, no storage): the macro does
  not and cannot instrument these directly — there is nothing to wrap. But if
  the getter body reads other tracked stored properties of `self`, those
  reads still register **wherever the computed property is ultimately
  accessed** — tracking is transitive through computed properties and through
  ordinary methods. This matters concretely for `AppModel.activeBook()`
  (a method, not a `var`, but the same transitivity applies): it reads
  `activeEditionId`, `library`, and the private `manifests` dictionary, and
  is called directly from `MiniPlayerView.body` (`if let active =
  model.activeBook()`, `MiniPlayerView.swift:13`) and from `RawkoonApp.swift:182`
  and `ContinueListeningView.swift:35`. Because that call happens inside
  `body`, all three of `activeEditionId`, `library`, and **`manifests`**
  become tracked dependencies of those views — even though `manifests` is a
  `private` implementation-detail dictionary that no view touches by name.

### The trap: `@ObservationIgnored` and properties that were never `@Published`

This is the most important behavior change to plan for, and it is specific to
this codebase's shape. Under `ObservableObject`, only `@Published` properties
were ever observed — every other `private var` (there are roughly 15 in
`AppModel` and 25+ in `AudiobookPlayer`: `apiClient`, `manifests`,
`downloaders`, `cancellables`, `verifiedCounts`, `pathMonitor`,
`readingProgressStore`, `player: AVQueuePlayer?`, `timeline`,
`interruptionObserver`, `commandTargets`, `seekID`, `isSeeking`, `artwork`,
`artworkTask`, etc.) was structurally inert to SwiftUI. Under `@Observable`,
**every stored property is tracked by default regardless of access level**,
unless explicitly excluded with `@ObservationIgnored`. Mechanically applying
the macro without auditing these properties does not break anything (it still
compiles, still behaves correctly), but it pays registrar-tracking overhead
on writes to properties no view will ever read, and — worse — it is easy to
get backwards, because "private" and "never read from a view" are **not** the
same thing here (see `manifests` above).

**Concrete rule for this migration, not a generic guideline:** before marking
a private stored property `@ObservationIgnored`, grep for every method that
reads it, and check whether *any* of those methods is called from inside a
view's `body` (directly, or transitively through another such method). If
yes — leave it tracked. If every read happens only inside an `async` method
invoked from `.task {}`, a button action, or another `Task {}` (i.e., never
synchronously during `body` evaluation) — it is safe and worthwhile to mark
`@ObservationIgnored`.

Applying that rule to `AppModel`: `apiClient` is read only from `async` methods
(`fetchDetails`, `login`, `loadLibrary`, etc. — never from a view `body`) →
safe to ignore. `manifests` is read transitively from `MiniPlayerView.body`
via `activeBook()` → **must stay tracked**. `pathMonitor`, `cancellables`
(deleted per above), `journalURL`, `deviceID`, `grantRefreshAttempts`,
`grantRefreshInFlight`, `pendingApnsToken`, `registeredApnsToken`,
`lastProgressWriteMillis`, `lastProgressPosition`, `verifiedCounts` — none of
these are read from any view body (confirmed no direct references outside
`AppModel.swift` itself) → safe to ignore. In `AudiobookPlayer`, the large
block of AVFoundation plumbing (`player`, `timeline`, `manifest`, `baseURL`,
`chapters`, `itemChapters`, `timeObserver`, `endObserver`,
`currentItemObserver`, `itemStatusObserver`, `seekID`, `isSeeking`,
`pausedAt`, `wasPlayingBeforeInterruption`, `interruptionObserver`,
`commandTargets`, `resetObserver`, `artworkURL`, `artwork`, `artworkTask`,
`sleepEndChapterIndex`, `lastSleepTick`) is never read from a view — every
view reads only the `private(set) @Published` surface — so the whole block is
a safe, high-value `@ObservationIgnored` batch.

**Confidence: HIGH** on the mechanism (default-tracks-everything,
`@ObservationIgnored` opts out — directly stated across every source
consulted, including Apple's own migration guide summary). The specific
per-property classification above is this document's own analysis of the
actual codebase (grep-verified call sites), not sourced from documentation —
treat it as a starting checklist for the phase, not a substitute for
re-verifying at implementation time if the code has drifted.

### The trap: reads outside `body` — closures and child-view initializers

SwiftUI's automatic tracking works because the framework wraps the evaluation
of a view's `body` getter in the equivalent of
`withObservationTracking { /* body runs here */ }`. Only property reads that
happen **synchronously during that evaluation** register as dependencies.
Two related failure modes to watch for while extracting view models and
touching call sites:

1. **Reads inside a `Task {}`, `.task {}` async closure, or a button/gesture
   action closure are not tracked by that mechanism.** They still *see*
   current values correctly (it's not a data-race issue), but reading a
   property only inside such a closure does not, by itself, cause the view to
   re-render when that property later changes — the view only re-renders on
   its *next* `body` evaluation triggered by some other tracked read.
   `MediaDetailView`'s async methods (`fetchDetails`, `fetchSimilar`,
   `refreshManagementData`, …) already write to `@State` (soon: view-model
   `@Observable` properties) as their result, and `@State`/model *writes* are
   what SwiftUI actually reacts to — so this pattern is already safe as
   written. The trap only bites if a *read* of an observable property is
   moved into an async closure and depended on for view refresh instead of a
   *write* — not a pattern present in this file today, but worth flagging
   for whoever writes the new view models, since it's an easy mistake to
   introduce during extraction.
2. **Reading an `@Observable` property inside a child view's own `init()`
   (as opposed to its `body`) does not establish tracking on that child's own
   render cycle.** If a child view computes a stored `let`/`var` from a
   parameter inside `init` rather than reading the parameter directly in
   `body`, later changes to the underlying property won't refresh that child
   on their own — the child only gets rebuilt (and its `init` rerun) when its
   **parent's** `body` re-evaluates for some other tracked reason. None of
   this app's views currently compute state in `init` from model properties
   (checked: `RootTabsView.init()` only touches `ProcessInfo` and a debug
   env var, not `AppModel`), so this is a forward-looking caution for the
   view-model phase rather than an existing bug to fix.

**Confidence: MEDIUM.** Corroborated by multiple independent 2025 sources
(objc.io's Swift Talk episode on Observation access tracking, fatbobman.com,
donnywals.com) all describing the same "only direct reads inside the tracked
closure register" mechanism, but the tool could not retrieve Apple's own
canonical wording verbatim for this specific nuance — treat the underlying
mechanism as solid, and the "no current instance of this bug in the codebase"
claim as this document's own grep-based check, not exhaustive proof.

### Threading — no change from what the code already does

`AppModel` is `@MainActor`; `AudiobookPlayer` is **not** annotated
`@MainActor` and instead hand-hops to main via `onMain(_:)` /
`DispatchQueue.main.async` (see `configureRemoteCommands()`,
`MPRemoteCommandCenter` handlers). `@Observable`'s `ObservationRegistrar` is
documented as thread-safe for the tracking mechanism itself, but this does
**not** relax the pre-existing rule that SwiftUI must observe UI-driving state
mutations on the main thread — `AudiobookPlayer` still needs every write to
its tracked properties (`positionSecs`, `isPlaying`, etc.) to happen on main,
exactly as it does today via the manual hops. **This migration does not
change or fix that threading discipline; it is unrelated to `@Observable`
and belongs to CONC-01 (Swift 6 mode) instead** — do not fold "should
`AudiobookPlayer` become `@MainActor`" into the OBS-01 phase; it is a separate
decision the strict-concurrency researcher should own.

---

## 2. Extracting a view model from `MediaDetailView`

### What moves to `MediaDetailViewModel` (`@Observable`) vs. what stays `@State`

Of the 34 `@State` properties (`MediaDetailView.swift:24-60`), the boundary is
"does this property exist because of a network call, a retry/error path, a
formatting decision, or a mutation to shared library state" (→ model) versus
"does this property exist purely to drive a sheet/disclosure/navigation
trigger, with no server round-trip or formatting logic behind it" (→ stays
`@State` in the view).

| Category | Properties | Destination |
|---|---|---|
| Fetch state + result | `details`, `loading`, `errorMessage` | Model |
| Request/watchlist flow | `requesting`, `requested`, `added`, `requestError`, `watchlistPending`, `inWatchlist` | Model |
| Similar-titles fetch | `episodesBySeason`, `similarItems`, `loadingSimilar`, `similarError` | Model |
| Management tab fetch + mutation | `managementItem`, `managementLoading`, `managementError`, `managementNotice`, `qualityProfiles`, `mediaFiles`, `mediaFilesType`, `downloads`, `pendingDownloadActionId`, `applyingManagementChange` | Model |
| Pure UI triggers (no network, no formatting) | `showingReleaseSearch`, `showingRemoveConfirm`, `menuReleaseSearch`, `pendingRemoveLibraryId`, `pendingRemoveTitle`, `similarMenuDetail` | View `@State` |
| Pure disclosure/expand-collapse UI | `expandedFileIDs`, `expandedFileSeasons` | View `@State` |
| Tab selection | `activeTab` | View `@State` — see note below |

**Judgment call, flagged explicitly:** `activeTab` (the `DetailTab` enum
selector) is itself pure UI state and should stay `@State`, but its
`.onChange(of: activeTab)` handlers in `body` (`MediaDetailView.swift:83-90`)
currently *trigger* `fetchSimilar()`/`refreshManagementData()` — i.e. the
*value* is UI-only but the *side effect of changing it* is business logic.
Keep `activeTab` as view `@State`, keep the `.onChange` in the view (it is
one line calling into the model: `Task { await viewModel.loadSimilarIfNeeded() }`),
and put the "should I actually fetch, or is data already loaded" guard logic
(`similarItems.isEmpty, !loadingSimilar`) inside that model method rather
than in the view's `.onChange` closure — this keeps the *decision* testable
and leaves the view only deciding *when* to ask.

**Judgment call, flagged explicitly:** `pendingDownloadActionId` looks like
UI (which row shows a spinner) but it correlates 1:1 with an in-flight async
management operation's lifecycle, not a purely visual toggle — recommend
moving it to the model alongside `applyingManagementChange`, since a test
asserting "the row for the download I just cancelled becomes non-pending
once the request resolves" only makes sense against the model's state, not
against a view.

### Method migration

Every `private func … async` in `MediaDetailView.swift` that calls
`model.api()` — `fetchDetails`, `fetchSimilar`, `refreshManagementData`,
`applyMonitoredChange`, `applyQualityProfileChange`, `runRescan`,
`clearFailedDownloadsAction`, `removeLibraryItem`, `fetchEpisodes`, and
several more of the same shape (grepped: 15+ methods reading `model.api()`)
— moves into `MediaDetailViewModel` essentially verbatim, with `model.api()`
replaced by whatever narrow API dependency the view model is given (see
below), and `model.isAdmin` / `library` reads replaced by parameters or an
injected `AppModel` reference passed at construction (the view model still
needs *some* handle on the shared session/admin state — it does not need to
re-own it).

Formatting helpers — `formatBytes`, `formatDuration`, `formatSpeed`
(`MediaDetailView.swift:857, 862, 1014`) — are exactly the LOW-priority
KIT-01 item from the audit (duplicated across `BookView` and elsewhere) and
belong in `RawkoonKit` as pure functions with tests, **not** in the view model
at all. Do KIT-01 (already scheduled earlier per the audit's own ordering)
before or during VM-01 so the extracted view model calls into
`RawkoonKit.formatBytes(_:)` rather than owning a third copy.

### Dependency injection across the actor boundary

`APIClient` is `actor APIClient` with ~60 `async throws` endpoint methods in
one 982-line file (`Rawkoon/APIClient.swift`). The natural instinct — define
one `protocol APIClientProtocol` mirroring the whole actor and inject that —
is the wrong shape for this codebase and is explicitly the anti-pattern
multiple 2025 write-ups warn against ("protocols written purely for testing…
require duplicating implementations" and become verbose at this size).
`MediaDetailViewModel` calls perhaps 10 of the ~60 methods
(`mediaModal`, `similar`, `libraryItem`, `qualityProfiles`, `libraryFiles`,
`downloads`, `updateLibraryMonitored`, `updateLibraryQualityProfile`,
`rescanLibraryItem`, `clearFailedDownloads`, plus episode/library-item
removal calls) — a protocol scoped to exactly those ten is the right size.

**Recommendation: a narrow, per-view-model protocol that `APIClient`
conforms to, not a struct of closures and not a monolithic protocol.**

```swift
@MainActor
protocol MediaDetailAPI: Sendable {
    func mediaModal(mediaType: String, tmdbId: Int) async throws -> MediaModalResponse
    func similar(tmdbId: Int, mediaType: String) async throws -> [TmdbSearchItem]
    func libraryItem(id: Int) async throws -> LibraryMedia
    func qualityProfiles() async throws -> QualityProfilesResponse
    // … the remaining ~6 methods this view model actually calls
}

extension APIClient: MediaDetailAPI {}
```

This works cleanly across the actor boundary because an `actor` can conform
to a protocol whose requirements are `async` without any special ceremony —
callers of a protocol-typed `any MediaDetailAPI` already have to `await`
every call regardless of whether the concrete type behind it is an actor, a
plain class, or a struct. That is precisely what makes this the right seam:
**the test double does not need to be an actor at all.** A fake conforming to
`MediaDetailAPI` can be a plain `final class` or even a `struct` returning
canned values from `async` (but not actually suspending) methods — there is
no cross-actor isolation to fight in the test, because the protocol
requirement is only "this call is `async throws`", not "this call runs on a
specific actor". This is the direct, concrete answer to "how do tests inject
a fake across an actor boundary": *they don't* — they inject a fake behind a
protocol that erases the actor-ness entirely, which is the standard and
correct way to make actor-backed dependencies testable in Swift.

Tradeoffs versus the alternatives, for this specific codebase:

| Approach | Fit here | Why |
|---|---|---|
| **Narrow per-view-model protocol** (recommended) | Good | Small surface (~10 methods), self-documents exactly what `MediaDetailViewModel` depends on, `APIClient` conforms via a one-line `extension`, pairs naturally with API-01's domain-extension split (each domain extension can back its own narrow protocol) |
| One `APIClientProtocol` mirroring all ~70 methods | Poor | Every unrelated screen's fake would need to stub 60 methods it never calls; violates the "deep module, narrow interface" principle the codebase's own `RawkoonKit` already demonstrates works |
| Struct of injected closures (`struct MediaDetailEndpoints { var fetchDetails: (...) async throws -> ... }`) | Workable but adds boilerplate with no offsetting benefit here | Valuable when you need per-call-site substitution (e.g., SwiftUI previews swapping one endpoint at a time) or when the consumer only ever needs 2-3 calls; at ~10 methods a protocol is no more verbose and reads more like a normal Swift dependency than an ad hoc struct of function values. Consider it only if a future, much smaller view model needs just one or two endpoints. |
| Passing the live `APIClient` actor directly into the view model, no seam at all | Poor for testability, fine for the mechanical "extract, don't yet add tests" step | Compiles today with `model.api()`'s current `APIClient?` type; if VM-01's tests are deferred to a follow-up phase this is an acceptable interim step, but it is not "testable without a renderer" as the audit's own goal requires — treat it as a stepping stone, not the destination |

**Confidence: MEDIUM-HIGH** on "actors can conform to async-only protocols
without isolation ceremony" (well-established Swift concurrency behavior,
corroborated across multiple 2025 sources including HackingWithSwift's
concurrency quick-start and the actor isolation proposal itself). The
specific "10-method narrow protocol per view model" sizing is this document's
own analysis of `MediaDetailView`'s actual call sites, not a sourced claim.

---

## 3. Ordering: `@Observable` before or after view-model extraction

**Do `@Observable` first — before extracting `MediaDetailViewModel` /
`BookViewModel`.** This is also what the audit's own recommended order and
`PROJECT.md`'s Key Decisions table already commit to; the reasoning below is
this document's grounding for *why*, not a restatement of the decision.

1. **Every future view model needs a handle on `AppModel`** (`model.api()`,
   `model.isAdmin`, `model.library`, `model.absoluteURL(_:)` are all called
   from `MediaDetailView`'s methods that will move into the view model).
   If the view model is extracted while `AppModel` is still
   `ObservableObject`, the extraction has to decide *now* whether the new
   view model is itself an `ObservableObject` (a fourth one, immediately
   creating more OBS-01 surface than existed before) or some in-between
   shape — and either way, converting `AppModel` afterward touches the new
   view model's dependency on it a second time. Sequencing `@Observable`
   first means the extraction is written once, directly in the target idiom.

2. **`bindPlayer()`'s Combine relay is the most structurally entangled piece
   of code touching both `AppModel` and `AudiobookPlayer`.** Extracting view
   models first would mean new consumer code gets added on top of an
   `objectWillChange` relay that is about to be deleted — any assumption a
   new view model's author makes about "when does a change to `player`
   become visible to `AppModel`-derived state" is answered differently before
   and after OBS-01. Doing OBS-01 first removes that relay and its ambiguity
   *before* anything new depends on the answer.

3. **OBS-01 is compiler-checked; VM-01 is not.** `@EnvironmentObject` on an
   `@Observable` type is a build failure, not a subtle runtime regression —
   which is exactly the kind of guardrail `PROJECT.md`'s "guardrails before
   the large refactors" decision is built around ("so the linter and the
   compiler hold the new boundaries rather than review alone"). Landing the
   mechanical, compiler-verified change first means that by the time the
   judgment-heavy extraction (the audit's own words: "the one that changes
   how the app is maintained") lands, reviewers are evaluating exactly one
   axis of risk instead of two entangled ones.

4. **`MiniPlayerView.body` already calls `model.activeBook()` on every tab**
   (confirmed above) — meaning `AppModel`'s observation behavior is on the
   critical path for a view that renders continuously throughout the app, not
   just on the detail screens being decomposed. Stabilizing that shared,
   high-traffic path first, independent of the two large-screen extractions,
   reduces the number of moving parts any single phase has to reason about.

**Confidence: HIGH** — this reasoning is derived directly from the
codebase's own call graph (`bindPlayer`, `MiniPlayerView.body`, the
`@EnvironmentObject` census) plus the project's own stated ordering
principle, not from external "Combine before MVVM" style opinions in the
literature (several of which argue the *opposite* order for greenfield code
with no legacy Combine wiring — that argument does not apply here precisely
because `bindPlayer()` exists and has to be dealt with).

---

## 4. Splitting `APIClient` (a ~70-method actor) across files

**`extension APIClient { ... }` in separate files is idiomatic and safe for
this actor**, and does not change isolation semantics at all: instance
methods added to an actor via an extension have an implicitly-isolated
`self`, exactly as if they had been declared in the actor's primary
declaration — the compiler treats extension members and primary-declaration
members identically for actor isolation purposes. This is precisely the
"costs nothing" characterization the audit gives API-01.

### What stays in the main `APIClient.swift` file

- Stored properties: `baseURL`, `session`, `token`, and the two
  `static let` `ISO8601DateFormatter` instances.
- `init(baseURL:token:)`.
- The shared private request-plumbing helpers currently at
  `APIClient.swift:388-523`: `makeRequest`, `resolveURL`, `mapStatus`,
  `parseISO8601`, `postExpectOK`, `sendPost`, `pathWithQuery`, and whatever
  `perform` helper wraps `URLSession.data(for:)` — every one of the ~60
  endpoint methods funnels through these.

### The access-control gotcha, specific to this file

Every one of those shared helpers is currently declared `private`. Swift's
`private` is scoped to the type **and its extensions in the same file** —
it does **not** extend across files, even for extensions of the same type in
the same module. Splitting the ~60 endpoint methods into
`APIClient+Library.swift`, `APIClient+Books.swift`, `APIClient+Downloads.swift`,
`APIClient+Admin.swift`, `APIClient+Discovery.swift` (the audit's own
suggested domain split) means every one of `makeRequest`, `perform`,
`mapStatus`, `postExpectOK`, `sendPost`, `pathWithQuery`, `resolveURL`, and
`parseISO8601` **must be widened from `private` to internal** (Swift's
default, no modifier — since it's all one module/app target, `internal` is
sufficient; there's no need for `public`). This is the one mechanical-but-
easy-to-miss step in API-01: a naive per-file split that leaves those helpers
`private` fails to compile the moment the first endpoint moves to another
file, with an error that clearly names the missing access, so this is
self-correcting during the work — but worth calling out up front so it's
budgeted as "rename ~8 helpers' access level" rather than discovered
mid-refactor.

Endpoint-specific private helpers that are genuinely only used by methods
within a single domain (if any exist once the split is drafted) can stay
`private` within that domain's own extension file — Swift's same-file rule
for `private` applies per-file, so `APIClient+Books.swift` can have its own
truly-private helpers invisible to `APIClient+Library.swift`, which is a
minor organizational win of the split beyond just navigability.

### `nonisolated` — likely not needed, but the rule if it comes up

All instance state and instance methods on an actor are isolated by default,
including across extensions. `nonisolated` lets specific members be called
synchronously from outside the actor, but it **cannot be applied to mutable
(`var`) stored properties** — only to methods, computed properties, and
`let` constants of `Sendable` type. None of `APIClient`'s three stored
properties (`baseURL: URL`, `session: URLSession`, `token: String?`) are
candidates for `nonisolated let` today because `token` is a `var` (it's
reassigned in `login(email:password:)`) and `session`/`baseURL` are private
implementation details never accessed synchronously from outside — there is
no reason to introduce `nonisolated` anywhere as part of a pure file-split.
If a future need arises for a caller to read `baseURL` synchronously without
`await`ing the actor, that specific property could become `nonisolated let
baseURL: URL` (it's a `Sendable` constant), but that is out of scope for
API-01 as a "split files, change nothing else" phase.

**Confidence: HIGH** on "extension members on an actor are isolated exactly
like primary-declaration members" and "`private` does not cross files even
within the same type" — both are core, uncontroversial Swift language rules,
confirmed by the Swift actor isolation documentation and corroborated by
independent 2025 write-ups. **Confidence: MEDIUM** on the specific
`nonisolated let` guidance for `var` vs `let` stored properties — this is
standard, well-understood behavior but the search tooling could not surface
Apple's canonical phrasing verbatim in this session; the underlying rule
(mutable stored properties cannot be `nonisolated`, immutable `Sendable` ones
can) is consistent across every source consulted and matches general Swift
concurrency knowledge.

---

## Roadmap implications

Suggested phase-level sequencing within this milestone (aligned with, and
justifying in more detail, the audit's own "Recommended order" table):

1. **OBS-01 (`@Observable` migration), as its own phase, before VM-01.**
   Scope: 3 classes (`AppModel`, `AudiobookPlayer`, `ReaderChrome`), 21
   `@EnvironmentObject` call sites, 11 `.environmentObject()` injection
   sites, one non-mechanical rewrite (`bindPlayer()`'s Combine pipeline →
   push callbacks), and an `@ObservationIgnored` audit pass across ~40 private
   stored properties using the "grep for body-reachable reads" rule above.
   Flag the `bindPlayer()` rewrite specifically for review — it is the one
   piece of this phase that is not compiler-verified by construction.

2. **API-01 (split `APIClient`), directly before VM-01**, exactly as the
   audit orders it (item 7 before item 8) — confirmed by this research as the
   right order for a second, independent reason beyond "why not": splitting
   into domain extensions first makes the narrow per-view-model protocol
   boundary (recommended in section 2) self-evident, since each protocol can
   mirror one domain extension's method set almost 1:1.

3. **VM-01 (extract `MediaDetailViewModel`, `BookViewModel`), last.** Use the
   state-classification table in section 2 as the starting checklist for
   `MediaDetailView`; expect `BookView` (1,227 lines, same shape per the
   audit) to decompose along an analogous line, though this research did not
   read `BookView.swift` directly — budget a similar but separate
   classification pass for it rather than assuming the `MediaDetailView`
   table transfers exactly.

## Gaps to address

- `BookView.swift` (1,227 lines) was not read in this research pass (out of
  the required-reading scope) — its `@State` inventory and network-call
  shape should be classified the same way before planning that half of VM-01.
- The exact set of `AudiobookPlayer` mutation sites that should call
  `onPositionChange`/`onPlaybackStateChange` was enumerated from the file as
  read here; re-verify against the file at implementation time in case other
  branches (e.g., inside `handleCurrentItemChanged()`) also need to fire the
  callback and were missed.
- Apple's canonical migration-guide page body could not be rendered by the
  fetch tool in this session (JS-rendered content); all Apple-sourced claims
  above are corroborated through independent secondary sources rather than
  the primary document's exact wording — worth a quick manual spot-check
  against `developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro`
  before the phase starts, if anything here looks surprising once
  implementation begins.

## Sources

- [Apple: Migrating from the Observable Object protocol to the Observable macro](https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro) — canonical migration guide (content corroborated via search snippets and secondary sources; primary page body not directly renderable this session)
- [A Deep Dive Into Observation — fatbobman.com](https://fatbobman.com/en/posts/mastering-observation/) — access-tracking mechanism, `withObservationTracking` semantics, thread-safety
- [Observing properties on an `@Observable` class outside of SwiftUI views — donnywals.com](https://www.donnywals.com/observing-properties-on-an-observable-class-outside-of-swiftui-views/) — model-to-model observation patterns and `withObservationTracking` pitfalls
- [Using `withObservationTracking` to monitor changes — polpiella.dev](https://www.polpiella.dev/observable-outside-of-a-view) — re-registration ("one-shot") behavior
- [Swift Talk S01E362: Observation — Access Tracking — objc.io](https://talk.objc.io/episodes/S01E362-swift-observation-access-tracking) — direct-read-only tracking scope, closures and nested contexts
- [Mastering Observation framework in Swift — swiftwithmajid.com](https://swiftwithmajid.com/2023/10/03/mastering-observable-framework-in-swift/) — `@ObservationIgnored` use cases
- [Swift Evolution SE-0306: Actors](https://github.com/apple/swift-evolution/blob/main/proposals/0306-actors.md) — actor isolation defaults, extension member isolation
- [How to make parts of an actor nonisolated — HackingWithSwift](https://www.hackingwithswift.com/quick-start/concurrency/how-to-make-parts-of-an-actor-nonisolated) — `nonisolated` constraints on stored properties
- Direct codebase reads: `apps/ios/Rawkoon/AppModel.swift`, `apps/ios/Rawkoon/AudiobookPlayer.swift`, `apps/ios/Rawkoon/APIClient.swift`, `apps/ios/Rawkoon/Views/MediaDetailView.swift`, `apps/ios/Rawkoon/Views/MiniPlayerView.swift`, `apps/ios/Rawkoon/Views/EbookReaderView.swift`, `apps/ios/Rawkoon/RawkoonApp.swift`, `apps/ios/docs/code-quality-audit.md`
