# Chapter-list filter — design

**Date:** 2026-08-31
**Status:** proposed
**Size:** bounded — one view, no server change, no new dependency

## Why

`BookView`'s audiobook chapter list is a plain `ForEach` over
`manifest.chapters` with no way to narrow it. The real library makes that a
problem rather than a theoretical one:

| Edition | Chapters |
|---|---|
| 64 — *Les secrets de la femme de ménage* | 76 |
| 11 — *La prof* | 83 |
| 62 — *Onyx Storm* | 69 |
| 59 — *La locataire* | 70 |

Finding "Chapitre 47" in 83 rows means scrolling past 46 of them. This is now
the only long list in the app with no escape hatch: `LibraryView` already has a
hand-rolled `searchField` for media and books, and `DiscoverView` searches TMDB.

Note this is a *filter*, not a search — the data is already local, in memory, and
tiny. Nothing is fetched.

## Scope

**In:** a filter field above the chapter list that narrows by chapter title and
by chapter number, appearing only when the list is long enough to need it.

**Out:** filtering the ebook Files list (it holds one or two rows), fuzzy
matching, and any change to what tapping a chapter does.

## Design

**Reuse, do not reinvent.** `LibraryView.searchField(_:text:)` already exists and
sets the app's convention — a capsule with a magnifying glass, a clearing
button, `autocorrectionDisabled()` and `.textInputAutocapitalization(.never)`.
Move it into `Rawkoon/Views/Components.swift` alongside `SpineRow` and
`StatusBadge`, and call it from both places. `LibraryView` keeps behaving
identically; `BookView` gets it for free. That is a smaller diff than a second
implementation and removes the chance of the two drifting.

Do **not** switch either screen to `.searchable`. That is a separate refactor with
no new capability, and it would change a screen that currently works.

**Matching.** One `@State private var chapterFilter = ""` in `BookView`, applied
to the already-sorted chapters:

- Case- and diacritic-insensitive on the title, so "menage" finds "ménage" — the
  library is French and this is the difference between the feature working and
  not. Use `localizedStandardContains`, which handles both.
- Also match the chapter number, so typing `47` finds chapter 47. Compare against
  `String(chapter.index + 1)` — the list is 1-based on screen — and accept a
  numeric match anywhere in the string so `4` shows 4, 14, 40–49.
- Empty filter shows everything.

**When it appears.** Only when the edition has more chapters than fit a screen —
a threshold constant of 12, defined once with a comment. A three-chapter
audiobook does not need a filter, and showing one is noise. This also means the
field is absent for single-file audiobooks, which have no chapter list at all.

**Empty state.** When the filter matches nothing, show a single muted line in the
list's own style rather than an empty gap. `BookView` already uses
`ContentUnavailableView` elsewhere for the media case; match whichever pattern
the surrounding chapter card uses.

**What does not change.** Row rendering stays `SpineRow`, tapping still seeks via
`model.openPlayer(editionId:resumeAt:)`, and the download/current-chapter
indicators are untouched. The filter is presentation only.

## Files

| File | Change |
|---|---|
| `Rawkoon/Views/Components.swift` | receives the shared `searchField` |
| `Rawkoon/Views/LibraryView.swift` | drops its private copy, calls the shared one |
| `Rawkoon/Views/BookView.swift` | filter state, the field, filtered `ForEach`, empty state |

No RawkoonKit change, no API change, no migration.

## Testing

The matching predicate is the only thing worth testing and it is currently
trapped in a view. Extract it as a small pure function — given chapters and a
query, return the filtered chapters — and put it where it can be tested. If it
goes in RawkoonKit it gets Linux CI coverage, which matters more now that the
reader work deletes 20 of the 58 kit tests.

Cases worth covering: empty query returns everything; diacritic-insensitive
match ("menage" → "ménage"); numeric match on the 1-based index; no match
returns empty; a query matching both a title and a number does not duplicate
rows.

Then the usual macbuild gate (`swift test`, `xcodebuild`), and an operator pass
to confirm the threshold feels right — 12 is a judgement call, not a measurement.
