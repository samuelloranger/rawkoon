# iOS Server-State Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iOS app memory-only, TanStack-style server state with optimistic Library mutations, targeted invalidation, and complete tested SSE coverage.

**Architecture:** `APIClient` remains an HTTP/SSE actor. A main-actor `ServerStateStore`, held by `AppModel`, owns typed query state, in-flight load deduplication, mutation snapshots, and SSE-driven invalidation. The API publishes a checked-in SSE contract artifact; iOS has an exhaustive registry for every stream and event kind.

**Tech Stack:** Swift 6/SwiftUI Observation/Swift Testing, Hono/Zod/Bun tests, existing `APIClient` actor, existing AppModel SSE reconnect loops, macbuild SSH for all iOS test/build gates.

**Spec:** `docs/superpowers/specs/2026-09-16-ios-server-state-store-design.md`

## Global Constraints

- Query cache is memory-only; clear it and cancel work on logout, server change, and account change.
- `APIClient` stays transport-only; views do not issue direct requests for migrated state.
- All state mutation is `@MainActor`; network calls retain `APIClient` actor isolation.
- Every optimistic mutation retains exact snapshots and rolls back only its own transaction.
- Never replace the existing entire Library list with page 1 after an invalidation; preserve loaded pages and scroll position.
- Every server SSE stream and payload kind must have a contract entry and an iOS handler (`patch`, `invalidate`, or `progress`).
- Do not persist API response cache to disk.
- Run focused Swift tests and the app-target suite/build in `macbuild:~/Sites/projets_perso/rawkoon`; a Linux-only check is insufficient.
- Preserve macbuild's existing untracked `HANDOFF.md` and `apps/ios/.swiftpm/` files. Do not use a temporary clone or worktree there.

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/shared/contracts/sse-contract.v1.json` | Versioned stream/kind/payload/policy artifact shared by API and iOS. |
| `apps/api/src/contracts/sseContract.ts` | Validates the artifact and exposes typed server contract IDs. |
| `apps/api/src/utils/sse.ts` | Contract-aware SSE response helper; routes must declare their contract entry. |
| `apps/api/src/contracts/sseContract.test.ts` | Ensures every route uses a declared contract entry and artifact is valid. |
| `apps/ios/Rawkoon/ServerState/ServerQueryKey.swift` | Typed keys and dependency-family matching. |
| `apps/ios/Rawkoon/ServerState/ServerStateStore.swift` | Observable cache, load deduplication, mutation ownership/snapshots, invalidation. |
| `apps/ios/Rawkoon/ServerState/SSEEventRegistry.swift` | Exhaustive contract-to-patch/invalidation/progress mapping. |
| `apps/ios/RawkoonTests/ServerStateStoreTests.swift` | Pure cache, rollback, deduplication, and lifecycle tests. |
| `apps/ios/RawkoonTests/SSEEventRegistryTests.swift` | Loads bundled contract and proves exhaustive handler coverage. |
| `apps/ios/Rawkoon/AppModel.swift` | Creates/clears store and forwards live events rather than incrementing refresh tokens. |
| `apps/ios/Rawkoon/APIClient.swift` | Returns created Library item from add; exposes typed SSE contract events. |
| `apps/ios/Rawkoon/Views/LibraryView.swift` | Reads the Library query state; retains loaded-page behavior. |
| `apps/ios/Rawkoon/Views/MediaDetailView.swift` | Runs Library-visible mutations through the store. |
| `apps/ios/Rawkoon/Views/DiscoverView.swift` and detail flow | Uses the optimistic Add transaction and cache ownership state. |
| `apps/ios/project.yml` | Bundles `sse-contract.v1.json` into `RawkoonTests`; regenerate Xcode project before macbuild tests. |
| `scripts/test-ios-macbuild.sh` | Runs in the existing macbuild checkout, generates the Xcode project, resolves an available iPhone simulator, and runs an optional test selector or simulator build. |

### Task 0: Add the repeatable macbuild app-target harness

**Files:**
- Create: `scripts/test-ios-macbuild.sh`
- Modify: `docs/decisions.md`

**Interfaces:**
- Produces `scripts/test-ios-macbuild.sh [RawkoonTests/TestClass]`.
- The script runs only from `~/Sites/projets_perso/rawkoon` on `macbuild`, installs XcodeGen through Homebrew only when absent, generates `apps/ios/Rawkoon.xcodeproj`, resolves an available iPhone simulator dynamically, and runs the optional `-only-testing` selector or `--build`.

- [ ] **Step 1: Write the harness acceptance command**

```bash
ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh RawkoonTests/SmokeTests'
```

Expected result: it must print the selected simulator UDID, run the app-target smoke test remotely, and return the remote xcodebuild exit status without touching `HANDOFF.md` or `apps/ios/.swiftpm/`.

- [ ] **Step 2: Run it and verify red**

Run: `ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh RawkoonTests/SmokeTests'`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the isolated SSH harness**

```bash
#!/usr/bin/env bash
set -euo pipefail
selector=${1:-RawkoonTests}
repo_root=$(git rev-parse --show-toplevel)
test "$repo_root" = "$HOME/Sites/projets_perso/rawkoon"
command -v xcodegen >/dev/null || brew install xcodegen
cd "$repo_root/apps/ios"
xcodegen generate
# Resolve an available iPhone UDID from `xcrun simctl list devices available --json`,
# then run xcodebuild test with -only-testing:$selector and CODE_SIGNING_ALLOWED=NO.
```

Document that the harness intentionally uses `~/Sites/projets_perso/rawkoon`, the user-designated macbuild checkout, and must preserve its unrelated untracked files.

- [ ] **Step 4: Run harness to green**

Run: `ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh RawkoonTests/SmokeTests'`

Expected: PASS through macbuild; the pre-existing untracked files remain present.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-ios-macbuild.sh docs/decisions.md
git commit -m "test(ios): add isolated macbuild harness"
```

### Task 1: Publish a contract for every SSE route and payload kind

**Files:**
- Create: `apps/shared/contracts/sse-contract.v1.json`
- Create: `apps/api/src/contracts/sseContract.ts`
- Create: `apps/api/src/contracts/sseContract.test.ts`
- Modify: `apps/api/src/utils/sse.ts`
- Modify: `apps/api/src/routes/library/libraryJobWorkerRoutes.ts`
- Modify: `apps/api/src/routes/notifications/index.ts`
- Modify: `apps/api/src/routes/admin/adminJobRoutes.ts`
- Test: `apps/api/src/contracts/sseContract.test.ts`

**Interfaces:**
- Produces `SSEContractEntry { id, path, kind, payload, ios_policy }` and `SSEContractID`.
- Produces `createContractSseResponse(contractID, options)`; no SSE route may create a response without an `SSEContractID`.
- Consumes the existing `createJsonSseResponse` polling helper and the library event stream.

- [ ] **Step 1: Write the failing API contract test**

```ts
it("declares every SSE route and kind exactly once", () => {
  expect(validateSseContract()).toEqual([]);
  expect(registeredSseRouteIDs()).toEqual(contractIDs());
});
```

Include literals for all current flows: library media, library book, library handshake, notification, library-migrate status, remux status, reindex status, and every admin job-status stream currently exposed by the API.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd apps/api && bun test src/contracts/sseContract.test.ts`

Expected: FAIL because the artifact and `validateSseContract` do not exist.

- [ ] **Step 3: Add the artifact and typed contract module**

```ts
export type SSEContractID = (typeof sseContract)[number]["id"];

export function validateSseContract(): string[] {
  return sseContract.flatMap((entry) =>
    entry.id && entry.path.startsWith("/") && entry.kind ? [] : [entry.id],
  );
}
```

Define each entry in JSON with `id`, `path`, `kind`, a JSON-schema-like payload shape, and one of `patch`, `invalidate`, `progress`.

- [ ] **Step 4: Make each SSE route declare its contract ID**

Wrap the existing library/event-stream, notification-stream, and job-status response creation with `createContractSseResponse`. Preserve heartbeat, abort cleanup, authentication, and wire payloads byte-for-byte; only add the contract declaration.

- [ ] **Step 5: Run API verification**

Run: `cd apps/api && bun test src/contracts/sseContract.test.ts && bun run typecheck`

Expected: PASS; route IDs and artifact IDs match exactly.

- [ ] **Step 6: Commit**

```bash
git add apps/shared/contracts/sse-contract.v1.json apps/api/src/contracts apps/api/src/utils/sse.ts apps/api/src/routes/library/libraryJobWorkerRoutes.ts apps/api/src/routes/notifications/index.ts apps/api/src/routes/admin/adminJobRoutes.ts
git commit -m "feat(api): publish SSE contract"
```

### Task 2: Build and prove the memory-only query cache core

**Files:**
- Create: `apps/ios/Rawkoon/ServerState/ServerQueryKey.swift`
- Create: `apps/ios/Rawkoon/ServerState/ServerStateStore.swift`
- Create: `apps/ios/RawkoonTests/ServerStateStoreTests.swift`
- Modify: `apps/ios/project.yml`

**Interfaces:**
- Produces `enum ServerQueryKey: Hashable { case libraryList(LibraryListKey); case libraryItem(Int); case discoverDetail(tmdbID: Int, type: String); case discoverDeck; case bookList; case bookItem(Int); case notifications; case unreadCount }`.
- Produces `@MainActor @Observable final class ServerStateStore` with `state(for:)`, `load(_:loader:)`, `invalidate(_:)`, `clear()`, `beginMutation(_:)`, `commit(_:)`, and `rollback(_:)`.
- `load` accepts `@Sendable () async throws -> Value`, deduplicates equal keys, and leaves last successful data visible while refresh runs.

- [ ] **Step 1: Write failing Swift tests for cache invariants**

```swift
@Test func equalLoadsShareOneTask() async throws {
    let store = ServerStateStore()
    let calls = LockedCounter()
    async let first: [LibraryMedia] = store.load(.libraryList(.default)) { calls.increment(); return [movie(id: 1)] }
    async let second: [LibraryMedia] = store.load(.libraryList(.default)) { calls.increment(); return [movie(id: 1)] }
    _ = try await (first, second)
    #expect(calls.value == 1)
}

@Test func rollbackRestoresTheExactListSnapshot() async {
    let store = seededStore(items: [movie(id: 1)])
    let token = store.beginMutation(.removeLibraryItem(1))
    store.removeLibraryItemOptimistically(id: 1, token: token)
    store.rollback(token)
    #expect(store.libraryList(.default).value?.map(\.id) == [1])
}
```

Also cover stale-with-value state, invalidate family matching, clear cancellation, and a late SSE update that cannot overwrite an owned mutation.

- [ ] **Step 2: Run on macbuild and verify red**

Run: `ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh RawkoonTests/ServerStateStoreTests'`

Expected: FAIL because the store, keys, and test fixtures do not exist.

- [ ] **Step 3: Implement typed entries and transaction ownership**

Use separate typed dictionaries for the initial Library/Discover domains; do not use `Any` or string URL keys. Store `value`, `error`, `updatedAt`, `isLoading`, and `Task` per key. A mutation token includes a UUID plus snapshots of every affected typed entry. `rollback` restores only snapshots owned by that token.

- [ ] **Step 4: Run focused macbuild test to green**

Run the exact Task 2 command.

Expected: PASS with all `ServerStateStoreTests` passing.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/ServerState apps/ios/RawkoonTests/ServerStateStoreTests.swift apps/ios/project.yml
git commit -m "feat(ios): add server state cache core"
```

### Task 3: Wire API responses, lifecycle, and exhaustive SSE handling

**Files:**
- Create: `apps/ios/Rawkoon/ServerState/SSEEventRegistry.swift`
- Create: `apps/ios/RawkoonTests/SSEEventRegistryTests.swift`
- Modify: `apps/ios/Rawkoon/APIClient.swift`
- Modify: `apps/ios/Rawkoon/AppModel.swift`
- Modify: `apps/ios/Rawkoon/Models.swift`
- Modify: `apps/ios/project.yml`

**Interfaces:**
- Changes `func addToLibrary(tmdbId:type:) async throws -> LibraryMedia` to decode the API's created item.
- Produces `func apply(_ event: SSEContractEvent, to store: ServerStateStore)` with no default drop case.
- `AppModel` owns one store, clears it with session lifecycle, and forwards each existing stream event into `SSEEventRegistry`.

- [ ] **Step 1: Write failing exhaustive-contract test**

```swift
@Test func everyBundledSSEContractEntryHasOneHandler() throws {
    let entries = try SSEContractFixture.load()
    #expect(Set(entries.map(\.id)) == SSEEventRegistry.handledContractIDs)
}
```

Add a test that `.media(id:)` invalidates `libraryItem(id)` and Library list keys, while `.book(id:)` invalidates only book/progress families.

- [ ] **Step 2: Run focused macbuild tests and verify red**

Run: `ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh RawkoonTests/SSEEventRegistryTests'`

Expected: FAIL because the artifact is not bundled and the registry does not exist.

- [ ] **Step 3: Decode the add response and bundle the contract**

Change the private `LibraryItemResponse` use at `APIClient.addToLibrary` to return `response.item`. Add the JSON artifact as a test/app resource in `project.yml` and regenerate the project; do not duplicate its event list in Swift.

- [ ] **Step 4: Implement explicit event handlers and AppModel forwarding**

Replace `libraryChangeToken += 1` / `bookChangeToken += 1` in `runLibraryEventsLoop` with registry application. Register notification, migration, remux, reindex, and admin job-status stream events according to their artifact policy. Preserve reconnect, heartbeat, authorization logout, and notification banner behavior.

- [ ] **Step 5: Run focused macbuild tests to green**

Run both Task 2 and Task 3 macbuild test commands.

Expected: PASS; the contract test proves that an added API stream or kind cannot lack iOS registration.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/APIClient.swift apps/ios/Rawkoon/AppModel.swift apps/ios/Rawkoon/Models.swift apps/ios/Rawkoon/ServerState/SSEEventRegistry.swift apps/ios/RawkoonTests/SSEEventRegistryTests.swift apps/ios/project.yml
git commit -m "feat(ios): register SSE cache invalidation"
```

### Task 4: Migrate Discover Add and Library media list to the store

**Files:**
- Modify: `apps/ios/Rawkoon/Views/DiscoverView.swift`
- Modify: `apps/ios/Rawkoon/Views/MediaDetailView.swift`
- Modify: `apps/ios/Rawkoon/Views/LibraryView.swift`
- Modify: `apps/ios/RawkoonTests/ServerStateStoreTests.swift`
- Create: `apps/ios/RawkoonTests/LibraryOptimisticFlowTests.swift`

**Interfaces:**
- Consumes `ServerStateStore.addToLibrary(tmdbID:type:provisional:) async` and `ServerStateStore.libraryList(_:)`.
- Produces a provisional `LibraryMedia` presentation state that is identifiable by TMDB ID, displays `Adding…`, and cannot duplicate the returned server item.

- [ ] **Step 1: Write failing optimistic-flow tests**

```swift
@Test func discoverAddShowsProvisionalRowThenReplacesIt() async throws {
    let store = seededStore(items: [])
    let request = ControlledAddRequest()
    async let add = store.addToLibrary(tmdbID: 7, type: "movie", request: request.call)
    #expect(store.libraryList(.default).value?.first?.tmdbId == 7)
    #expect(store.libraryList(.default).value?.first?.isProvisional == true)
    request.succeed(with: movie(id: 42, tmdbID: 7))
    _ = try await add
    #expect(store.libraryList(.default).value?.map(\.id) == [42])
}

@Test func failedDiscoverAddRemovesProvisionalRow() async {
    // Controlled request throws; assert the original empty list is restored.
}
```

- [ ] **Step 2: Run focused macbuild tests and verify red**

Run: `ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh RawkoonTests/LibraryOptimisticFlowTests'`

Expected: FAIL because no optimistic add transaction or provisional presentation exists.

- [ ] **Step 3: Move Library loading to typed query state**

Replace `LibraryView`'s direct `media`, loading, error, and token-driven reload ownership with its `library.list` query state. Keep the current loaded-page merge and sentinel behavior; invalidation refreshes currently loaded pages in place.

- [ ] **Step 4: Route Discover Add through the store**

In `MediaDetailView.submitAdd`, call the store transaction rather than `APIClient.addToLibrary` directly. Construct the provisional presentation from the already-rendered TMDB details. Keep current disabled state, localized error copy, haptic success trigger, and `added` display behavior.

- [ ] **Step 5: Run macbuild app-target proof**

Run the Task 4 focused test, then:

`ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh RawkoonTests'`

Then run the simulator build by calling `ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh --build'` (implement `--build` as a second accepted selector mode; it generates the project and executes `xcodebuild build -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`).

Expected: PASS; the app-target suite and simulator build prove the real target links the new state layer.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/Views/DiscoverView.swift apps/ios/Rawkoon/Views/MediaDetailView.swift apps/ios/Rawkoon/Views/LibraryView.swift apps/ios/RawkoonTests/LibraryOptimisticFlowTests.swift apps/ios/RawkoonTests/ServerStateStoreTests.swift
git commit -m "feat(ios): make library adds optimistic"
```

### Task 5: Migrate remaining Library-visible mutations and finish gates

**Files:**
- Modify: `apps/ios/Rawkoon/Views/LibraryView.swift`
- Modify: `apps/ios/Rawkoon/Views/MediaDetailView.swift`
- Modify: `apps/ios/Rawkoon/Views/Detail/DetailFileRow.swift`
- Modify: `apps/ios/Rawkoon/Views/Detail/DetailDownloadRow.swift`
- Modify: `apps/ios/RawkoonTests/LibraryOptimisticFlowTests.swift`
- Modify: `.github/workflows/ios.yml`

**Interfaces:**
- Consumes `removeLibraryItem`, `updateMonitored`, `updateQualityProfile`, `invalidateDownloadHistory`, and `invalidateLibraryRollup` store mutations.
- Produces no new direct view-to-API mutation path for Library-visible state.

- [ ] **Step 1: Write failing mutation dependency tests**

```swift
@Test func removeRollsBackWithoutResettingLoadedPages() async throws {
    let store = seededStore(pages: [[movie(id: 1)], [movie(id: 2)]])
    try await store.removeLibraryItem(id: 1, request: { throw TestError.failed })
    #expect(store.loadedIDs == [1, 2])
}

@Test func monitorPatchUpdatesListAndItemBeforeNetworkReturns() async {
    // Start controlled request; assert both cached representations have monitored == false.
}
```

Cover quality profile, download action/file deletion invalidation, remove rollback, and an SSE event arriving while each mutation is pending.

- [ ] **Step 2: Run focused macbuild test and verify red**

Run the Task 4 macbuild focused test command with `-only-testing:RawkoonTests/LibraryOptimisticFlowTests`.

Expected: FAIL because the remaining views still mutate local state or call `APIClient` directly.

- [ ] **Step 3: Route every Library-visible mutation through the store**

Replace direct mutation calls in the listed views with store transactions. Preserve confirmation dialogs, busy controls, current success/error toast text, haptics, and pagination/scroll behavior. Mark affected query families stale after commit and perform no global refresh-token bump.

- [ ] **Step 4: Add CI gates and run full verification on macbuild**

Ensure `ios.yml` runs the app-target test suite containing `ServerStateStoreTests`, `SSEEventRegistryTests`, and `LibraryOptimisticFlowTests` before the simulator build. Run:

```bash
ssh macbuild 'cd ~/Sites/projets_perso/rawkoon/apps/ios && swiftformat Rawkoon RawkoonTests Sources Tests --lint'
ssh macbuild 'cd ~/Sites/projets_perso/rawkoon && scripts/test-ios-macbuild.sh RawkoonTests && scripts/test-ios-macbuild.sh --build'
cd apps/api && bun test src/contracts/sseContract.test.ts && bun run typecheck
git diff --check
```

Expected: all commands exit 0; app target validates logic and wiring on macbuild, API validates SSE completeness, and no whitespace errors remain.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/Views apps/ios/RawkoonTests/LibraryOptimisticFlowTests.swift .github/workflows/ios.yml
git commit -m "feat(ios): invalidate library state by endpoint"
```

## Plan self-review

- Spec coverage: Tasks 1 and 3 implement the complete SSE contract and exhaustive iOS registration; Task 2 implements memory-only deduplicated state and rollback; Task 4 implements the Discover-to-Library proof; Task 5 covers all remaining Library-visible mutations, CI, and macbuild verification.
- Placeholder scan: no deferred implementation language or undefined task references remain; each task has a red command, green command, exact files, interfaces, and commit boundary.
- Type consistency: `ServerQueryKey`, `ServerStateStore`, `SSEContractID`, and `SSEEventRegistry` use the same names throughout; later tasks consume interfaces introduced by earlier tasks.
