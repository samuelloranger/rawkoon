# iOS server-state store design

## Goal

Make API-derived iOS state behave like TanStack Query: cached and deduplicated
within a running app, fresh on a cold launch, immediately responsive to
mutations, recoverable on failure, and coherent with server-sent events (SSE).

The first user-visible proof is: after adding a movie or show from Discover,
Library shows an `Adding…` row immediately; success replaces it with the
server's authoritative item and failure removes it with an error. Closing and
reopening the app always performs a fresh network load.

## Scope

The first delivery owns server state that can change Library's visible media:

- Library list and item queries.
- Discover detail/deck queries affected by add or remove.
- Add, remove, monitor, quality-profile, download-control, download-history,
  and library-file mutations.
- Every server SSE stream and payload kind, including streams without a
  dedicated iOS screen.

It does not migrate playback, reader state, authentication, unrelated settings,
or unrelated admin data. It does not persist API query data to disk.

## Architecture

`APIClient` remains the stateless, authenticated HTTP/SSE transport actor.
`ServerStateStore` is a single `@MainActor @Observable` instance held by
`AppModel` and is the only owner of cached API response state.

```
SwiftUI view -> query key -> ServerStateStore -> APIClient
                                 ^                 |
                                 |                 v
                       SSE handler / mutation <- server
```

The store exposes typed, hierarchical `QueryKey` cases rather than string URL
keys. Initial cases are `library.list(filter, sort, page)`, `library.item(id)`,
`discover.detail(tmdbID, type)`, `discover.deck`, `books.list`,
`books.item(id)`, `progress`, `notifications.list`, and
`notifications.unreadCount`.

Each entry stores its value, fetch state, last successful fetch, error, and a
single in-flight `Task`. Equal concurrent queries share that task. A query may
render its last value while a stale refresh runs; a query with no value renders
its existing loading/error state.

The store clears all entries and cancels work on sign-out, active-server change,
or account change. It has no disk backing, so construction on a cold launch
starts with no data and a visible query loads from the network.

## Mutations

A mutation is a `ServerStateStore` transaction:

1. Identify the exact affected query keys and retain their snapshots.
2. Apply an optimistic patch on the main actor.
3. Await the `APIClient` request.
4. On success, merge the authoritative response and mark dependent queries
   stale for background refresh.
5. On failure, restore every snapshot, publish the existing user-facing error,
   and retain no provisional data.

`POST /api/library` must decode and return the server's created `LibraryMedia`
on iOS, matching the web mutation. Before that response, Add inserts a stable
provisional row keyed by its TMDB id into each matching cached Library list.
The provisional row is visually explicit (`Adding…`) and is replaced, never
duplicated, by the returned server item. It is also removed or marked owned in
affected Discover caches.

Removal immediately removes the item from cached lists and item cache, then
rolls back on failure. Monitor and quality-profile changes patch the same item
in item/list caches. Download controls and file/history changes retain their
current local UI while invalidating item and list rollups after success.

## Invalidation and SSE

Invalidation is endpoint-aware, never a global refresh token. A successful
mutation invalidates only its dependency family:

| Change | Optimistic patch | Invalidate after success |
| --- | --- | --- |
| Add | matching Library lists and Discover ownership | Library lists, created item, Discover deck/detail |
| Remove | Library lists and item | Library lists, item, related Discover detail/similar |
| Monitor / quality profile | item plus matching list rows | item and Library lists |
| Download/file/history | none beyond current action UI | item, Library lists, download history |
| `media(id)` SSE | none unless it confirms a pending mutation | `library.item(id)` and matching Library lists |
| `book(id)` SSE | none | book item/list and progress keys |
| notification SSE | unread count/list patch | notification list/count |
| progress/status SSE | active progress query patch | only its owning query |

`AppModel` remains responsible for the lifecycle and reconnect policy of live
SSE connections, but forwards every decoded event to the store. The store
performs the patch/invalidation. Existing `libraryChangeToken` and
`bookChangeToken` consumers are retired only after their views use query keys.

### SSE completeness contract

The API generates a versioned, checked-in SSE contract artifact listing every
SSE route, handshake shape, event kind/payload schema, and intended iOS policy:
`patch`, `invalidate`, or `progress`. It includes library media/book events,
notifications, and every job/progress stream.

iOS decodes that artifact in an app-target test and has an exhaustive Swift
registry keyed by stream and kind. The test fails if the artifact has an event
without a registered handler, or a handler references an absent contract event.
An unknown event at runtime is logged and causes a conservative invalidation of
the active query family for its stream; it is never silently discarded.
Contract-version mismatch causes a reconnect and a conservative refresh of
active queries.

## View API and migration

Views ask the store for a typed query state and trigger loading with a small
SwiftUI-facing observer/wrapper. They do not hold duplicate arrays, loading
flags, errors, refresh tokens, or direct API calls for migrated data.

The rollout is deliberately narrow:

1. Add store primitives, pure key/dependency rules, and tests.
2. Make `APIClient.addToLibrary` return the created item.
3. Migrate Library media list/item and Discover add flow.
4. Migrate Library-visible mutations and their SSE handlers.
5. Add the SSE contract artifact and completeness gates.
6. Expand one domain at a time only after the first slice is stable.

Existing view design, navigation, toast copy, authorization behavior, and
pagination UX remain unchanged. Infinite-scroll pages already loaded remain
visible through an invalidation; refresh replaces those pages in place instead
of collapsing to page one.

## Error handling and concurrency

All store mutation state changes happen on the main actor. Network calls use
the existing `APIClient` actor. A mutation records ownership of provisional
state, so a later SSE event cannot overwrite it before the mutation commits or
rolls back. Completion merges only if it still owns that transaction; otherwise
the response invalidates and refetches its dependency family.

Transport, authorization, and server errors retain existing localized error
copy. A failed background refresh preserves prior data with a non-blocking
error; a first load has no stale value and presents the current retry UI.

## Verification

- Unit-test query-key equality, hierarchy matching, freshness, request
  deduplication, logout clearing, optimistic commit, rollback, and concurrent
  SSE/mutation ordering.
- Test Discover Add -> provisional Library row -> authoritative replacement,
  plus failure rollback and Library removal without scroll reset.
- Test each Library-visible mutation's dependency map.
- Generate and validate the SSE contract in API CI; run the iOS exhaustive
  registry test in the app-target test suite.
- Exercise SSE-driven Library refresh in an app-target integration test without
  restarting the app.

## Acceptance criteria

- A successful Discover add appears in Library before navigation returns.
- A failed add leaves no phantom Library row.
- Every Library-visible mutation updates its affected cached views immediately
  and converges to server state.
- Every server SSE route and kind has a tested iOS registry entry.
- No query data survives logout, server change, or cold launch.
- Existing iOS app-target tests, API tests, formatting, lint, and CI build
  gates pass.
