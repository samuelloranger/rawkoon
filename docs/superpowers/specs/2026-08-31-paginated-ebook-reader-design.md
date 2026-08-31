# Paginated ebook reader — design

**Date:** 2026-08-31
**Status:** approved, not implemented
**Supersedes:** the scroll-based reader shipped in 1.11.0

## Why

The reader shipped in 1.11.0 renders one EPUB spine document at a time in a
`WKWebView` as continuous vertical scroll. It has no pages, no table of contents,
no typography controls, and a hard-coded `19px` font size. Navigation is a
`‹ 3 / 92 ›` pager — and the real library runs 74–97 spine documents per book, so
finding a chapter means counting.

It also only opens EPUB, because it unzips the archive itself. The `.mobi` files
that ship beside several editions show an *EPUB only* badge.

The decision is to stop hand-rolling the rendering layer and adopt
[foliate-js](https://github.com/johnfactotum/foliate-js) — the engine behind the
Foliate reader — which brings pagination, a real TOC, CFI positions, and support
for every ebook format Rawkoon can hold.

## Scope

**In:** pagination, typography controls, page themes, table of contents, a
progress readout, and support for all five of Rawkoon's `EbookFormat` values.

**Out, deliberately:** in-book search (upstream calls its own search *"extremely
slow"*), bookmarks and highlights, a scrolled-mode toggle, font-family choice,
brightness. Audiobook playback is untouched.

**Blocked behind this:** the haptics work. Its page-turn trigger cannot be
specified until pages exist. Everything else in that design (chapter change,
play/pause, skips, sleep timer, network outcomes) is independent.

## The dependency

Vendored, not fetched at runtime. ES modules, no build step.

| | |
|---|---|
| Repo | `github.com/johnfactotum/foliate-js` |
| Pinned commit | `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01) |
| Licence | MIT; vendored libs BSD-3-Clause, MIT, Apache |
| Also vendored | its `zip.js` (random access) and `fflate` (KF8 fonts) |

Rawkoon is GPL-3.0; all of the above are compatible. Ship the licence texts with
the bundle and record the pinned SHA next to the vendored files, so the next
person can tell what they have and diff an upgrade.

## Format support

Rawkoon's `EbookFormat` is exactly `epub | azw3 | mobi | pdf | cbz`
(`apps/shared/src/types/books.ts`). All five are already supported by
foliate-js, so **no server or shared-type change is needed for formats** — this
part is iOS-only.

| Tier | Formats | Renderer | Controls that apply |
|---|---|---|---|
| Reflowable | `epub`, `mobi`, `azw3` | `paginator.js` | Pagination, typography, themes |
| Fixed layout | `cbz`, pre-paginated `epub` | `fixed-layout.js` | Pagination only |
| Experimental | `pdf` | upstream PDF path | Pagination only, may fail |

Three consequences the implementer must handle:

- **Typography and theme controls must hide for fixed-layout books**, not sit
  there inert. `book.rendition.layout === "pre-paginated"` is the signal.
- **KF8 decompression is slow** by upstream's own description. `mobi`/`azw3`
  need a visible loading state, not a frozen screen.
- **PDF is "highly experimental"** upstream. Do not advertise it. Render it if it
  works and show an explicit "this file may not render" state if it does not.

`isReadableEbook` and the *EPUB only* badge in `BookView` are **deleted**, not
extended: every format Rawkoon can hold becomes openable.

## Architecture

### Host shell

A single bundled HTML file holds a `<foliate-view>` and the glue script. The
Swift side owns the file on disk, the settings, and the position; the JS side
owns rendering and reports back.

```
BookView ──▶ EbookReaderSheet (SwiftUI)
                 │  local file URL, reader settings, resume position
                 ▼
             WKWebView  ── rawkoon-book:// ──▶ WKURLSchemeHandler ──▶ file on disk
                 │
                 └── host.html + vendored foliate-js
                        │  postMessage: relocate / toc / ready / error
                        ▼
                    EbookReaderSheet updates progress + UI
```

### Serving the archive: a scheme handler, with Range

`view.open()` accepts `File | Blob | URL`. Passing bytes through
`evaluateJavaScript` is not viable — a CBZ can be hundreds of MB — and JS
`fetch()` cannot read a `file://` URL under WKWebView's CORS rules.

So register a `WKURLSchemeHandler` for a private `rawkoon-book://` scheme that
serves the downloaded file and **honours `Range` request headers**, then call
`view.open(new URL("rawkoon-book://current"))`.

**This is the highest-risk part of the design.** foliate-js's zip loader wants
random access; if Range handling is subtly wrong it will work on a 1 MB EPUB and
fail on a large CBZ. Test it against the largest file in the library
deliberately, not just the convenient ones.

### CSP is mandatory

Upstream is explicit: *"CSP is imperative"* and *"Do NOT use this library
without CSP unless you completely trust the content."* Book content is arbitrary
downloaded HTML.

The host shell carries a `Content-Security-Policy` meta that forbids script
execution in book content. Scripted EPUBs are unsupported by the library anyway
(it relies on `blob:` URLs; see WebKit bug 218086).

## API surface the implementer needs

From the upstream README, at the pinned commit:

```js
import './foliate-js/view.js'
const view = document.createElement('foliate-view')
document.body.append(view)
await view.open(source)          // File | Blob | URL | book interface
```

- **Navigation:** `view.goTo(destination)` — accepts a path, a section index, or
  a CFI. `view.prev()`, `view.next()`.
- **Position:** the `relocate` event fires with `detail = { range, index,
  fraction }`. This is the single source of progress.
- **Section load:** the renderer's `load` event fires with `detail = { doc, index }`.
  `doc` is the section's `Document` — this is where reader CSS gets injected.
- **TOC:** `book.toc` is an array of `{ label, href, subitems }`, nested.
  Navigate with `view.goTo(href)`.
- **CFI:** `CFI.fromRange(range, filter?)` and `CFI.toRange(doc, cfiString,
  filter?)` from `epubcfi.js`.
- **Paginator options are `setAttribute`-only** — there is no JS property API:
  `flow` (`"paginated"` | `"scrolled"`), `margin` (px), `gap` (%),
  `max-inline-size` (px), `max-block-size` (px), `max-column-count` (int),
  `animated` (bool).
- **Styling hooks:** `::part(filter)` applies a CSS filter to book content
  excluding overlays; `::part(head)` / `::part(foot)` style the paginator's
  running header and footer.

Known upstream limitations to design around: no continuous scrolling across
sections; the paginator inherits CSS multi-column's weaknesses (slow, some
styles do not behave); search is extremely slow; PDF is highly experimental.

## Reading position

`relocate` gives a `range`, so store a real CFI.

**Schema:** add a nullable `cfi TEXT` column to `book_reading_progress`.
`spine_index` / `spine_path` / `spine_count` / `scroll_fraction` stay as a coarse
fallback for a book whose CFI cannot be resolved — a re-download that changes the
document structure, for instance.

**Migration is free:** `book_reading_progress` has 0 rows in production, so there
is no existing position to convert. The column is additive; rolling back to the
1.11.0 image keeps working, because the old code never reads it.

**Resolution order on open:** CFI if present and resolvable → else spine
path/index plus fraction → else the start of the book. The existing
`ReadingProgressReconciler.resolve` already implements the fallback half of this
and keeps its tests.

**Server:** `PUT /api/books/editions/:id/reading-progress` gains an optional
`cfi`; the GET returns it. Same last-write-wins rule, unchanged.

## Controls and UI

All settings are **global**, not per-book, persisted in `UserDefaults`, and
reapplied on every `load` event.

- **Typography:** font size, line height, margin width. Size and line height are
  injected CSS on `detail.doc`; margin maps to the paginator's `margin`
  attribute. Re-paginates live.
- **Themes:** dark, sepia, light — the page theme is independent of the app's
  dark-only chrome. Injected CSS.
- **Table of contents:** a sheet rendering `book.toc` with nesting, current
  chapter highlighted, tap to `view.goTo`.
- **Progress readout:** percent through the book and pages left in the chapter,
  both from `relocate`'s `fraction` plus the paginator's page count.
- **Page turns:** swipe, and tap on the left/right edge.

Fixed-layout books hide the typography and theme controls.

## What gets deleted

The hand-rolled rendering layer becomes dead code the moment the engine lands.
Its only consumer is `EbookReaderView`.

| File | Lines |
|---|---|
| `Sources/RawkoonKit/ZipArchive.swift` | ~290 |
| `Sources/RawkoonKit/Inflate.swift` | ~270 |
| `Sources/RawkoonKit/EpubPackage.swift` | ~195 |
| `Tests/RawkoonKitTests/EpubTests.swift` | ~150 |

Also remove `FileStore.epubExtractionURL` and the extraction step; downloading
the file to disk stays exactly as it is. `ReadingProgress.swift` and its tests
**stay** — the store and reconciler are still the position model.

Keeping any of it would be sunk-cost reasoning. A hand-written DEFLATE decoder
is a real maintenance liability, and it was only ever justified while we rendered
spine documents ourselves.

## Testing, and an honest limit

This trades testable pure Swift for a WebView + JS integration that RawkoonKit
cannot unit-test at all. Deleting `EpubTests.swift` removes 20 of the 58 kit
tests, and `Inflate` was the only thing exercising non-trivial logic on Linux in
CI.

What replaces it:

1. **A compile gate** on macbuild (`swift test`, then `xcodebuild` for the
   simulator) — necessary, not sufficient.
2. **A scripted smoke pass** over every ebook file in the real library — 33 EPUBs
   plus the `.mobi` files — asserting each one reaches `relocate` at least once
   and reports a sane page count. This is the closest thing to a regression test
   the design allows, and it is worth building as a DEBUG harness rather than
   checking books by hand.
3. **Deliberate large-file testing** of the Range path, per the risk above.
4. **A device pass** by the operator. Pagination quality, theme legibility and
   gesture feel cannot be judged from CI, and nobody implementing this can
   confirm it from a terminal.

State that limit plainly in the PR rather than implying the feature is verified.

## Risks

| Risk | Mitigation |
|---|---|
| Range handling wrong → large archives fail silently | Test the largest CBZ/EPUB in the library explicitly |
| Vendored engine drifts from upstream | SHA pinned and recorded; upgrades are a deliberate diff |
| CSS multi-column mis-renders some books | Tiering; the smoke pass over all 40 real files catches the worst |
| KF8 slowness reads as a hang | Explicit loading state for `mobi`/`azw3` |
| PDF simply does not work | Unadvertised, with an explicit failure state |
| Reader quality is unverifiable in CI | Device pass, and say so in the PR |
