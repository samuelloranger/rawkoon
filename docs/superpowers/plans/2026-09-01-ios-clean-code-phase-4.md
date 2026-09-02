# iOS clean-code milestone — phase 4 (seams + view models) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Split the 1009-line `APIClient` into per-domain extension files, add the app's first unit-test bundle, and extract `MediaDetailView` (1431 LOC) and `BookView` (1244 LOC) into tested `@Observable` view models — with zero user-visible behavior change.

**Architecture:** Mechanical, safe work first (APIClient split → test bundle), then the two behavior-sensitive view-model extractions on a codebase that now has a place to test them. The view models are plain `@Observable` classes holding only *data* state; they do NOT store `AppModel` (a `@State`-initialized VM cannot read `@Environment`). Each VM async method receives the resolved `client: APIClient` (and `model: AppModel` where it needs live app state) as a parameter; the view passes them from its `@Environment` at the call site. Pure-derivation methods move wholesale. SwiftUI-only coupling (`dismiss()`, `.onChange`, `navigationDestination` bindings, `.sheet` wiring) stays in the view.

**Tech Stack:** SwiftUI, iOS 18, Swift 6, `@Observable`, XcodeGen `testTarget` (`bundle.unit-test`, no host app), Swift Testing, macbuild (Xcode 26.3) as the only real gate.

**Spec:** `docs/superpowers/specs/2026-09-01-ios-clean-code-milestone-design.md`
**Surface map (authoritative worklist — enumerated funcs, @State inventories, coupling list):** `apps/ios/.superpowers/sdd/phase4-surface-map.md`

## Global Constraints

- **No user-visible behavior change.** Every screen renders and behaves identically. The extractions move where code *lives*, never what it *does*.
- **Behavior-preserving method moves:** when a method moves from a view to a VM, its body is copied VERBATIM except: `model.api()` → the injected `client`; `self.<dataState>` reads/writes stay identical (the property now lives on the VM); a call needing `dismiss()` returns a signal instead (see Task 3). Do not "improve" error handling, rename, or re-order.
- **The VM stores only data-state** (per the map's §2.3/§3.3 tables). View-state (sheet toggles, expanded sets, `activeTab`/`activeLane`, `chapterFilter`) stays `@State` on the view.
- **macbuild ssh is the only real gate.** No local Swift. Resync + sha-check before every macbuild run.
- **`grep -c 'Task {' apps/ios/Rawkoon/AudiobookPlayer.swift` stays 1** (unchanged by this phase, but never regress it).
- Build settings in `project.yml`, never a generated `.xcodeproj`. New commits only.
- Swift 6 `complete` strict concurrency is on — the new VMs default to `@MainActor` (app-target default isolation), which is correct for UI-driving `@Observable` models.

## macbuild verify commands

```
# RawkoonKit + (after Task 2) app-target tests:
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/samuelloranger/rawkoon && git fetch -q origin && git checkout -q -B feat/ios-cleancode-phase-4 origin/feat/ios-cleancode-phase-4 && git log --oneline -1 && cd apps/ios && swift test 2>&1 | tail -15'
# App build + app-target unit tests on a simulator (after Task 2):
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/samuelloranger/rawkoon/apps/ios && xcodegen generate >/dev/null 2>&1 && DEST=$(xcrun simctl list devices available | grep -oE "iPhone [0-9][0-9A-Za-z ]*" | head -1); xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon -destination "platform=iOS Simulator,name=$DEST" -only-testing:RawkoonTests 2>&1 | tail -30'
# App build only (Tasks 1, 3, 4 intermediate):
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/samuelloranger/rawkoon/apps/ios && xcodegen generate >/dev/null 2>&1 && xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon -destination "generic/platform=iOS Simulator" 2>&1 | tail -25'
```

---

## Task 1: Split `APIClient` into per-domain extension files

Mechanical, behavior-preserving. The only non-trivial rule: **Swift `private` is file-scoped**, so the 17 shared helpers must become `internal` before domain funcs can move to other files.

**Files:**
- Modify: `apps/ios/Rawkoon/APIClient.swift` (becomes core: actor decl, init, iso8601 statics, the 17 helpers as `internal`, `mediaDecoder`/`mediaEncoder`, `APIError`/free types)
- Create: `APIClient+Auth.swift`, `APIClient+Discovery.swift`, `APIClient+Library.swift`, `APIClient+Books.swift`, `APIClient+Downloads.swift`, `APIClient+Admin.swift` — each `extension APIClient { … }`
- Worklist: the map's §1.2 bucket table (every func → its file) and §1.3 (the 17 helpers).

- [ ] **Step 1: Make the 17 shared helpers `internal`**

In `APIClient.swift`, change `private` → `internal` (drop the keyword, since `internal` is the default) on exactly the 17 members in map §1.3: `makeRequest`, `perform`, `resolveURL`, `mapStatus`, `parseISO8601`, `mediaDecoder`, `mediaEncoder`, `get`, `post`, `postExpectOK`, `sendPost`, `patch`, `sendPatch`, `postRaw`, `pathWithQuery`, `putExpectOK`, and the two static formatters `iso8601WithFractionalSeconds`/`iso8601`. Actor isolation still protects them (nothing outside the actor can call them). No other change this step.

- [ ] **Step 2: Move `EmptyBody` and shared DTOs to core, domain DTOs to their file**

`EmptyBody` (L998) is used by both `rescanBookEdition` (books) and `rescanLibraryItem` (library) — make it `internal` and keep it in `APIClient.swift`. Every other `private nested` DTO (map §1.4) moves into the SAME new file as its single owning func (file-scoped `private` requires this). Func-body-local structs (`addToLibrary`/`addBook` `Body`) move automatically with their func.

- [ ] **Step 3: Move each domain func to its extension file**

Per the §1.2 table, cut each domain func from `APIClient.swift` and paste it into `extension APIClient { … }` in the bucket's file. Keep the `// MARK:` comments with their funcs. Each new file starts with `import Foundation` (+ any type the DTOs need). Verify `libraryAudiobooks` (L141, legacy) and `getProgress` (L319, legacy) still have callers before moving — grep; move them regardless (to Library / Books respectively), do not delete.

- [ ] **Step 4: Verify on macbuild**

App-build command → `** BUILD SUCCEEDED **`. No behavior change — this is pure code movement + visibility widening.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/APIClient.swift apps/ios/Rawkoon/APIClient+*.swift
git commit -m "refactor(ios): split APIClient into per-domain extension files"
```

---

## Task 2: Add the app-target unit-test bundle

Enables the VM tests in Tasks 3-4. No host app (per the milestone's decision — the VM logic tests don't launch the app).

**Files:**
- Modify: `apps/ios/project.yml` (add a `targets: RawkoonTests` entry + the scheme test wiring)
- Create: `apps/ios/RawkoonTests/SmokeTests.swift`

- [ ] **Step 1: Declare the test target in `project.yml`**

Add under `targets:` (sibling to `Rawkoon`):
```yaml
  RawkoonTests:
    type: bundle.unit-test
    platform: iOS
    sources: [RawkoonTests]
    dependencies:
      - target: Rawkoon
    settings:
      base:
        SWIFT_VERSION: "6.0"
        GENERATE_INFOPLIST_FILE: true
        PRODUCT_BUNDLE_IDENTIFIER: cloud.samlo.rawkoon.tests
```
Add (or extend) a `schemes:` block so `Rawkoon`'s scheme runs this bundle under `test`:
```yaml
schemes:
  Rawkoon:
    build:
      targets:
        Rawkoon: all
    test:
      targets:
        - RawkoonTests
    run: {}
    profile: {}
    analyze: {}
    archive: {}
```
(If a `schemes:` block already exists, add the `test.targets` entry rather than duplicating.)

- [ ] **Step 2: Add a smoke test that proves the bundle links against the app target**

`apps/ios/RawkoonTests/SmokeTests.swift`:
```swift
import Testing
@testable import Rawkoon

struct SmokeTests {
    @Test func appModuleLinks() {
        // Proves the RawkoonTests bundle compiles against @testable import Rawkoon.
        // A real assertion lands with the first view-model test in Task 3.
        #expect(Bool(true))
    }
}
```

- [ ] **Step 3: Verify on macbuild — the test bundle builds and runs**

Run the `xcodebuild test … -only-testing:RawkoonTests` command. Expected: `SmokeTests` runs and passes (`TEST SUCCEEDED`). If `@testable import Rawkoon` fails, the app target must build for testing — confirm `ENABLE_TESTABILITY` is YES in Debug (XcodeGen sets it by default for the test config; if not, add `ENABLE_TESTABILITY: YES` to the app target's Debug config).

- [ ] **Step 4: Commit**

```bash
git add apps/ios/project.yml apps/ios/RawkoonTests/SmokeTests.swift
git commit -m "build(ios): add the app-target unit-test bundle (no host app)"
```

---

## Task 3: Extract `MediaDetailViewModel`

Move the 21 data-state properties (map §2.3) and the non-rendering methods (map §2.2) out of `MediaDetailView` into a tested `@Observable` class. The view keeps its 9 view-state properties, its `@Environment`, and all SwiftUI-only coupling.

**Files:**
- Create: `apps/ios/Rawkoon/ViewModels/MediaDetailViewModel.swift`
- Create: `apps/ios/RawkoonTests/MediaDetailViewModelTests.swift`
- Modify: `apps/ios/Rawkoon/Views/MediaDetailView.swift` (delete moved state+methods; call the VM)

**Interfaces:**
- Produces: `@MainActor @Observable final class MediaDetailViewModel`, `init(tmdbId: Int, mediaType: String, title: String, posterPath: String?, libraryId: Int?)`, holding the 21 data-state vars from map §2.3. Async methods take what they need: `func fetchDetails(client: APIClient, isTV: Bool) async`, `func refreshManagementData(client: APIClient, isAdmin: Bool) async`, etc. `removeLibraryItem` returns `Bool` ("did remove the currently-displayed item") so the view calls `dismiss()`.

- [ ] **Step 1: Write the VM skeleton + first failing test**

Create `MediaDetailViewModel.swift` with the class, init, and the 21 `var`s (names/types verbatim from map §2.1). Move the **pure-derivation** methods first (map §2.2 rows marked "pure": `scannedDate`, `resolutionText`, `trackSummary`, `subtitleSummary`, `metaLine(for:)`, `groupedSeasonFiles`, `metaLine`, `yearValue`, `hasDetailsToShow`). Write `MediaDetailViewModelTests.swift` testing one pure derivation that needs no network — e.g. `groupedSeasonFiles` groups+sorts a fixture `mediaFiles`:
```swift
import Testing
@testable import Rawkoon

@MainActor struct MediaDetailViewModelTests {
    @Test func groupedSeasonFilesSortsBySeasonThenEpisode() {
        let vm = MediaDetailViewModel(tmdbId: 1, mediaType: "tv", title: "X", posterPath: nil, libraryId: 10)
        vm.mediaFiles = [ /* fixtures: two seasons, out of order */ ]
        let grouped = vm.groupedSeasonFiles
        // assert ordering/grouping matches the view's prior output
    }
}
```
(Fill the fixture from the real `LibraryFileInfo` shape; assert the exact grouping the old computed var produced.)

- [ ] **Step 2: Run the test to verify it fails**

`swift test` won't cover this (app target). Run the `xcodebuild test -only-testing:RawkoonTests` command. Expected: FAIL (VM/method not yet present) → then PASS once Step 1's code compiles. If it passes immediately, the test asserts nothing meaningful — strengthen it.

- [ ] **Step 3: Move the network/decision methods, applying the transform rule**

Move each non-pure method from map §2.2 into the VM, body verbatim except `model.api()` → the injected `client` parameter, and reads of `model.isAdmin`/`model.*` → an injected parameter or argument. Signatures gain the dependencies they use:
- `fetchDetails` → `func fetchDetails(client: APIClient) async` (fetches modal + watchlist; the TV-episode branch calls `fetchEpisodes`).
- `refreshManagementData` → `func refreshManagementData(client: APIClient, isAdmin: Bool) async`.
- `applyMonitoredChange`/`applyQualityProfileChange`/`runRescan`/`clearFailedDownloadsAction`/`performDownloadAction`/`deleteDownloadEntryAction`/`toggleSimilarMonitored`/`toggleWatchlist`/`fetchEpisodes`/`fetchSimilar`/`submitRequest`/`submitAdd` → each takes `client: APIClient` (and `isAdmin` where the view gated on it).
- `removeLibraryItem(id:deleteFiles:)` → `func removeLibraryItem(client: APIClient, id: Int, deleteFiles: Bool) async -> Bool` returning whether the removed id equals the displayed `libraryId` (the view then calls `dismiss()`).
- `handleSimilarMenu` is pure dispatch over view-state it no longer owns → keep in the view (it sets `menuReleaseSearch`/`similarMenuDetail` which stay view-state).

- [ ] **Step 4: Rewire `MediaDetailView` to the VM**

Add `@State private var vm = MediaDetailViewModel(tmdbId: tmdbId, mediaType: mediaType, title: title, posterPath: posterPath, libraryId: libraryId)`. Delete the 21 moved `@State` and the moved methods. Replace body reads of the moved state with `vm.<name>`. Replace method calls with `vm.<method>(client: client, …)` where `client` is resolved once (`guard let client = model.api() else { … }`) — preserving each call site's existing guard/error behavior. Keep: the 9 view-state `@State`, `@Environment(AppModel.self)`, `@Environment(\.dismiss)`, the `.onChange(of:)` wiring (now calling `vm` methods inside `Task {}`), the `navigationDestination`/`.sheet` bindings (map §5). For `removeLibraryItem`, the view's wrapper does `if await vm.removeLibraryItem(…) { dismiss() } else { await vm.fetchSimilar(client:) }`.

- [ ] **Step 5: Verify on macbuild — build + the VM tests**

App-build command green, then the `xcodebuild test -only-testing:RawkoonTests` command green. Manually reason through 2-3 screen interactions (load, request, management refresh) to confirm identical behavior.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/ViewModels/MediaDetailViewModel.swift apps/ios/RawkoonTests/MediaDetailViewModelTests.swift apps/ios/Rawkoon/Views/MediaDetailView.swift
git commit -m "refactor(ios): extract MediaDetailViewModel, tested without a renderer"
```

---

## Task 4: Extract `BookViewModel`

Same pattern for `BookView` — 15 data-state properties (map §3.3), methods from §3.2. `BookView` reads live `AppModel` state (`model.player`, `model.downloadPlans`, `model.errorMessage`, `model.openPlayer`, `model.startDownload`), so those specific methods take `model: AppModel` as a parameter (the map §5 injection note); pure derivations move wholesale.

**Files:**
- Create: `apps/ios/Rawkoon/ViewModels/BookViewModel.swift`
- Create: `apps/ios/RawkoonTests/BookViewModelTests.swift`
- Modify: `apps/ios/Rawkoon/Views/BookView.swift`

**Interfaces:**
- Produces: `@MainActor @Observable final class BookViewModel`, `init(book: BookListItem)`, holding the 15 data-state vars from map §3.3. Methods take `client: APIClient`/`model: AppModel` as they need them. Pure derivations (`alignLaneToAvailableEditions`, `preferredEbookFile`, `ebookMetrics`, `audiobookMetrics`, `factsLine`, `metadataRows`, the edition computed vars, `message(for:)`, the formatters) move as-is.

- [ ] **Step 1: VM skeleton + first failing test**

Create `BookViewModel.swift` (class, `init(book:)`, the 15 vars). Move the pure derivations. Write `BookViewModelTests.swift` testing `alignLaneToAvailableEditions()` (pure decision logic: flips `activeLane` when the current lane has no edition) with a fixture `detail` — this is the highest-value pure unit to lock down. Assert the exact lane-flip behavior the view had.

Note: if `activeLane` stays view-state (map §3.3 lists it as view-state), `alignLaneToAvailableEditions` — which *mutates* `activeLane` from data — is the coupling point. Resolve it: the VM computes and RETURNS the aligned lane (`func alignedLane(current: BookDetailLane) -> BookDetailLane`), the view assigns it. Test the pure function.

- [ ] **Step 2: Run to verify fail → pass**

`xcodebuild test -only-testing:RawkoonTests`. FAIL then PASS.

- [ ] **Step 3: Move the network/decision methods**

Move `loadBookDetail`, `addEdition`, `fetchManifest`, `recoverManifestAfterRescan`, `loadEbookFiles`, `rescanEbookEdition`, `openEbook`, `downloadEbook`, `ensureLocalEbookFile`, `refreshAll` — body verbatim, `model.api()` → injected `client`, and the methods that read live app state take `model: AppModel`. Keep the documented ordering in `refreshAll` exactly (map §3.2). Pure filesystem/derivation helpers (`remoteEbookURL`, `localEbookURL`, `isEbookDownloaded`, `ebookExtension`, `ebookFormatRank`, `fileMeta`, `renderedOverviewText`, `chapterExtension`, `formattedPublishedDate`, `formattedStatus`) move as-is. `isChapterDownloaded`/`isCurrentChapter` read `model.downloadPlans`/`model.player` → take `model` as a parameter.

- [ ] **Step 4: Rewire `BookView`**

`@State private var vm = BookViewModel(book: book)`; seed `activeLane` from `preferEbook` as today (view-state). Delete moved state+methods; body reads → `vm.<name>`; the inline button-action closures in `audiobookActionButtons`/`audiobookDownloadButton` (map §5, L395-529) call `vm` methods inside `Task {}`, passing `client`/`model`. `.sheet(item: $releaseSearchLane, onDismiss:)`'s reload sequence becomes `await vm.onReleaseSearchDismissed(client:model:)`. Keep `activeLane`, `showingPlayer`, `releaseSearchLane`, `previewDocument`, `chapterFilter`, the per-row progress flags, and `@Environment(AppModel.self)` on the view.

- [ ] **Step 5: Verify on macbuild — build + tests**

App-build + `xcodebuild test -only-testing:RawkoonTests` both green. Reason through: audiobook load/recovery, ebook open/download, add-edition, release-search-dismiss reload — identical behavior.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/ViewModels/BookViewModel.swift apps/ios/RawkoonTests/BookViewModelTests.swift apps/ios/Rawkoon/Views/BookView.swift
git commit -m "refactor(ios): extract BookViewModel, tested without a renderer"
```

---

## Self-review

- **Spec coverage:** audit item 7 (APIClient split) → Task 1; the app-target test bundle (spec phase 4 seam) → Task 2; audit item 8 (extract MediaDetail/Book view models + tests) → Tasks 3-4.
- **Behavior preservation:** the transform rule (verbatim body, `model.api()`→`client`, model reads→parameters, `dismiss()`→returned signal) keeps every method's behavior; view-state stays in the view; the map's coupling list (§5) is honored item-by-item (`dismiss`, `.onChange`, `navigationDestination`, `.sheet` wiring, live-player reads).
- **Injection consistency:** VMs never read `@Environment`; `MediaDetailViewModel(tmdbId:mediaType:title:posterPath:libraryId:)` and `BookViewModel(book:)` construct from `let` init params only, so `@State private var vm = …(…)` is legal. `client`/`model`/`isAdmin` are per-call parameters — named identically across the VM method signatures and the view call sites.
- **Test reality:** Tasks 3-4 tests run only in the Task-2 bundle on macbuild (no Linux). Each starts with a pure-derivation test (no network) — the highest-value, deterministic units. Network methods are covered by the build + manual reasoning, stated plainly (mocking `APIClient` is out of scope this phase).
- **Placeholder scan:** the per-method moves reference the surface map's enumerated tables as the worklist (concrete file:line lists), with the exact transform spelled out — not vague "move the methods". Test bodies show the assertion shape; the implementer fills fixtures from the real DTO shapes in the repo.
