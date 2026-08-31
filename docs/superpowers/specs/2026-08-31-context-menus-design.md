# Context menus and swipe actions — design

**Date:** 2026-08-31
**Status:** proposed
**Size:** bounded — existing views and existing API methods, no server change

## Why

The app has **one** `swipeActions` and **zero** `contextMenu` in 21 view files.
Long-pressing a poster or swiping a row is how iOS users expect to reach an
item's actions, and every one of those actions today requires navigating into a
detail screen and finding a control.

The actions already exist and are already wired — this is about reaching them in
one gesture instead of three taps.

## Scope

**In:** a context menu on library posters and on the rows of the management
screens, plus swipe actions where a row has one obvious destructive or primary
action.

**Out:** any new capability. If an action is not already implemented on
`APIClient`, it is out of scope. Also out: drag-and-drop, menu previews
(`contextMenu(preview:)`), and reordering.

**Explicitly out — and this matters:** no destructive action goes in a swipe
without confirmation, and none goes in a context menu without `role:
.destructive`. A library item's removal can take files off disk
(`removeFilesOnDelete` in `MediaDetailView`), so it must never be one accidental
swipe away.

## What already exists to expose

Verified against `APIClient` and the views:

| Action | Method | Admin only |
|---|---|---|
| Toggle monitored | `updateLibraryMonitored(id:monitored:)` | yes |
| Set status | `updateLibraryStatus(id:status:)` | yes |
| Set quality profile | `updateLibraryQualityProfile(id:qualityProfileId:)` | yes |
| Add to library | `addToLibrary(tmdbId:type:)` | yes |
| Request | `createRequest(_:)` | no |
| Add a book edition | `addBookEdition(bookId:kind:)` | yes |
| Rescan a book edition | `rescanBookEdition(bookId:kind:)` | yes |

Non-admins see *Request* where admins see *Add*, which is the rule `BookView` and
`LibraryView` already follow. The menu must respect `model.isAdmin` the same way
rather than offering actions that will 403.

## Design

**One shared menu builder per item kind, not per screen.** `MediaPosterCard` is
rendered from `LibraryView` and `MediaDetailView`; books are rendered from
`LibraryView` and `HomeView`. Attaching menus at the call sites would duplicate
them 4–6 times and let them drift. Instead add the menu inside the shared card
components in `Components.swift`, taking the actions as a closure or a small
value type so the card stays presentation-only and does not gain a dependency on
`AppModel`.

**Media poster (`MediaPosterCard`)** — long-press yields:
- *Toggle monitored* (admin)
- *Search releases* — pushes the existing interactive search rather than grabbing
- *Open details* — the same destination as a tap, for discoverability
- *Remove from library* (admin, `role: .destructive`) → confirmation dialog,
  reusing `MediaDetailView`'s existing remove flow including its "delete files"
  choice. Do **not** build a second removal path.

**Book card** — long-press yields:
- *Read* / *Play* depending on which editions exist, mirroring `BookView`'s own
  preference logic
- *Add audiobook* / *Add EPUB* when that edition is missing (admin)
- *Rescan* (admin)

**Management rows** — `RequestsView`, `UsersView`, `IndexersView`,
`QualityProfilesView`. Here swipe actions fit better than long-press, because
these are `List` rows:
- Requests: swipe to *Approve* / *Deny* — the two actions the screen exists for
- Users, Indexers, Quality profiles: swipe to *Delete* with confirmation, only
  where a delete method already exists

Honest caveat: this install has a handful of rows in each of those screens, so
the value there is low until they grow. If scope needs cutting, cut the
management screens and keep the posters and book cards.

**Haptics.** Deliberately not in this spec. Board #922 owns the haptics pass and
its chosen scope already covers "outcomes of network actions", which is exactly
what these menu items trigger. Adding feedback here would duplicate that
decision in a second place.

## Files

| File | Change |
|---|---|
| `Rawkoon/Views/Components.swift` | menus on the shared card components |
| `Rawkoon/Views/LibraryView.swift` | pass the action closures |
| `Rawkoon/Views/HomeView.swift` | pass the action closures for book cards |
| `Rawkoon/Views/MediaDetailView.swift` | expose its remove flow for reuse |
| `Rawkoon/Views/RequestsView.swift` | swipe approve/deny |
| `Rawkoon/Views/UsersView.swift`, `IndexersView.swift`, `QualityProfilesView.swift` | swipe delete, where a method exists |

No RawkoonKit change, no API change, no migration.

## Testing

Almost nothing here is unit-testable: it is menu construction and existing calls.
The one piece worth extracting is **which items a menu should contain** for a
given item state and admin flag — a pure function from (item, isAdmin) to a list
of action cases. Test that: a non-admin never gets *Add* or *Remove*; a book with
both editions offers both *Read* and *Play*; a book with no audiobook offers *Add
audiobook*.

The rest is a macbuild compile plus an operator pass. Long-press timing, whether
the destructive confirmation feels safe, and whether the menus are discoverable
cannot be judged from CI.
