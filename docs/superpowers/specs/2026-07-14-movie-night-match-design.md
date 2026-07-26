# Movie Night Match — shared Discover sessions with auto-grab on match

## Goal

Turn the single-player Discover swipe deck into a shared household activity:
multiple users swipe the same card stack from their own devices, and a title
two or more of them swipe right on is added to the library immediately — no
separate request/approve step for the group case.

Today `useDiscoverDeck` (`apps/web/src/pages/discover/_hooks/useDiscoverDeck.ts`)
is entirely per-request: the deck query excludes items already served,
dismissed (`DiscoverDismissal`), or in the library, all scoped to the calling
user, and `addCurrent()` calls `POST /api/library` directly. That route is
admin-gated (`ensureAdmin` in `libraryListRoutes.ts`) — a non-admin household
member's swipe-right would 403 today. Separately, `MediaRequest` already gives
non-admins a request/approve/deny path, but it's disconnected from Discover.
Movie Night Match reuses `MediaRequest` as the authorization bridge instead of
inventing a new one.

## Scope

### Data model (new Prisma models)

```
model DiscoverSession {
  id        Int      @id @default(autoincrement())
  code      String   @unique            // short shareable join code
  hostId    String   @map("host_id")
  host      User     @relation(fields: [hostId], references: [id], onDelete: Cascade)
  deckSnapshot Json  @map("deck_snapshot")   // ordered [{tmdb_id, media_type, ...}], frozen at creation
  createdAt DateTime @default(now()) @map("created_at")
  expiresAt DateTime @map("expires_at")      // createdAt + 6h, not renewable
  endedAt   DateTime? @map("ended_at")

  members DiscoverSessionMember[]
  swipes  DiscoverSessionSwipe[]

  @@map("discover_sessions")
}

model DiscoverSessionMember {
  id        Int      @id @default(autoincrement())
  sessionId Int      @map("session_id")
  session   DiscoverSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  joinedAt  DateTime @default(now()) @map("joined_at")

  @@unique([sessionId, userId], map: "uq_session_member")
  @@map("discover_session_members")
}

model DiscoverSessionSwipe {
  id        Int      @id @default(autoincrement())
  sessionId Int      @map("session_id")
  session   DiscoverSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId    String   @map("user_id")
  tmdbId    Int      @map("tmdb_id")
  mediaType String   @map("media_type")   // "movie" | "tv" (matches DiscoverDeckItem, not LibraryMedia's "show")
  createdAt DateTime @default(now()) @map("created_at")

  // Only right-swipes are recorded — left-swipes have no downstream effect
  // and don't need cross-device sync (see Non-goals).
  @@unique([sessionId, userId, tmdbId, mediaType], map: "uq_session_swipe")
  @@index([sessionId, tmdbId, mediaType], map: "ix_session_swipe_match_lookup")
  @@map("discover_session_swipes")
}
```

`User` gains a `discoverSessionsHosted` / `discoverSessionMemberships` back-relation,
same pattern as its existing `watchlistItems` / `discoverDismissals` relations.

### Deck: one frozen snapshot per session, not per-member personalization

`POST /api/discover/sessions` (host only) calls the existing discover-deck
query once, excluding only items already in `LibraryMedia` (the one exclusion
that's globally true), and freezes the result into `deckSnapshot`. Every
member's client renders that same array in that same order — no per-member
exclusion by personal watchlist/dismissal, so nobody's card position ever
drifts out of sync with anyone else's. `GET /api/discover/sessions/:code`
returns the snapshot plus current members; joining does not re-run discovery.

### Swipe endpoint and match rule

`POST /api/discover/sessions/:id/swipes` — body `{ tmdb_id, media_type }` from
a right-swipe only. Left-swipes and "add to my watchlist" stay 100% local,
same as solo Discover today (`watchlistCurrent`/`dismissCurrent` untouched).

On insert, count distinct `userId` for `(sessionId, tmdbId, mediaType)`. On the
row that brings the count to 2:

1. Look up whether any of the matched users `isAdmin`.
   - **Yes** → call `addOrUpdateLibraryFromTmdb` directly (the same service
     function `POST /api/library` calls), server-side, bypassing the HTTP
     route's `ensureAdmin` check since this call didn't originate from a user
     request — it's the system acting on a session-level decision. Emit
     `match` with `action: "grabbed"`.
   - **No** (session is all non-admin members) → create a `MediaRequest`
     (status `pending`, `requestedById` = the second matcher) exactly like
     the existing search-and-request flow does, so it surfaces in the admin's
     existing approve/deny queue. Emit `match` with `action: "requested"`.
2. A 3rd+ matcher on an already-matched title is a no-op (idempotent, unique
   constraint already prevents duplicate swipe rows).

This makes "who can trigger a real grab" a strict function of existing
`User.isAdmin` + `MediaRequest`, not a new permission concept.

### Realtime: session-scoped SSE, same shape as notifications

`notificationEventBus` (`apps/api/src/services/notificationEvents.ts`) is an
in-process `EventEmitter` that the `/api/notifications/stream` route filters
by `userId`. Add a sibling `discoverSessionEventBus` filtered by `sessionId`
instead, with a new route `GET /api/discover/sessions/:id/stream` built on the
same inline-`ReadableStream` pattern as `routes/notifications/index.ts`
(project has a documented working pattern here — reuse it verbatim, do not
reintroduce the `createJsonSseResponse`-vs-manual-controller issue noted in
that file's comments). Events: `member_joined`, `member_left`, `match`,
`session_ended`. Individual swipes are not broadcast — only matches.

### Frontend

- New route `/discover/session/:code`. Entry point: "Start Movie Night" button
  on the existing `/discover` page, opens a share sheet with the join code/link.
- `useDiscoverSessionDeck(code)` — thin variant of `useDiscoverDeck`: fetches
  the frozen snapshot once, no `fetchBatch`/low-water refill logic (fixed-size
  deck for the session's lifetime).
- `useDiscoverSessionStream(sessionId)` — mirrors `useNotificationStream`,
  drives a match toast/banner ("🎬 It's a match — *Sicario* is downloading" or
  "...was requested, waiting on admin approval") and a small avatar-presence
  strip from `member_joined`/`member_left`.
- Swipe-right calls `POST /api/discover/sessions/:id/swipes` instead of
  `useAddToLibrary` directly; optimistic advance stays identical to today's
  `advance()`/`rollback()` pattern in `useDiscoverDeck`.

## Data flow

```text
Host: POST /api/discover/sessions
  -> run discover-deck query once, exclude items already in LibraryMedia
  -> freeze as DiscoverSession.deckSnapshot, return {code, join_url}

Member: opens /discover/session/:code
  -> GET /api/discover/sessions/:code -> same snapshot, join as DiscoverSessionMember
  -> open SSE /api/discover/sessions/:id/stream

Any member swipes right on card N
  -> POST /api/discover/sessions/:id/swipes {tmdb_id, media_type}
  -> insert DiscoverSessionSwipe, count distinct userId for that title
  -> count == 2:
       any matcher isAdmin?  -> addOrUpdateLibraryFromTmdb (direct grab)
       else                  -> create MediaRequest(status: pending)
     emit "match" on discoverSessionEventBus(sessionId)
  -> all connected members' SSE streams render the match banner
```

## Error handling

- Session expiry (`expiresAt`, 6h from creation, not renewable): join/swipe
  after expiry returns 410 Gone; client shows "This movie night has ended."
- Swipe on a title the session has already matched: accepted (unique
  constraint no-ops the duplicate), no second grab/request attempt.
- `addOrUpdateLibraryFromTmdb` failure on match (TMDB down, indexer error):
  same failure surfaced today by the admin Discover path — emit `match` with
  `action: "failed"` so the group sees it rather than silently dropping it.
- A member leaving/closing the tab is not tracked as a hard "leave" — SSE
  disconnect alone drives `member_left` for presence UI; it does not remove
  their swipe history or affect match counting.

## Tests and acceptance criteria

1. Two distinct users swiping right on the same `(tmdb_id, media_type)` within
   one session produces exactly one `LibraryMedia`/`MediaRequest` side effect,
   verified by asserting on the third+ duplicate swipe that no second grab or
   request is created.
2. Admin-in-session vs. no-admin-in-session are separately tested: former
   asserts `addOrUpdateLibraryFromTmdb` was called directly; latter asserts a
   `pending` `MediaRequest` was created and no library grab happened.
3. SSE test: a second connected member's stream receives the `match` event
   within one poll interval of the second swipe landing.
4. Expired-session test: swipe/join after `expiresAt` returns 410, no rows
   written.
5. Deck-snapshot test: two members joining the same session at different
   times receive byte-identical `deckSnapshot` ordering.

## Non-goals

- No syncing of left-swipes, per-member watchlist adds, or dismissals across
  a session — those stay exactly as private as solo Discover today.
- No persistent "match history" or cross-session social graph; a session and
  its swipes are disposable once `expiresAt` passes (no scheduled cleanup job
  is in scope either — expired rows are simply inert and excluded by the 410
  check, cleanup can be a follow-up).
- No push notifications for matches beyond the in-app SSE banner (no email/webhook).
- No changing `MediaRequest`'s existing single-admin approve/deny UI — this
  reuses it unmodified.
- No new invite/auth system — join codes are only meaningful to already
  logged-in household users, same trust boundary as the rest of the app.
