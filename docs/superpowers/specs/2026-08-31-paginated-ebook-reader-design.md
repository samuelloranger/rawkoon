# Paginated ebook reader — design

**Date:** 2026-08-31
**Status:** approved, not implemented
**Supersedes:** the scroll-based reader shipped in 1.11.0
**Revision:** rewritten to use the Readium Swift toolkit. The first version of
this document specified foliate-js; see *Why Readium and not foliate-js*.

## Why

The reader shipped in 1.11.0 renders one EPUB spine document at a time in a
`WKWebView` as continuous vertical scroll. It has no pages, no table of contents,
no typography controls, and a hard-coded `19px` font size. Navigation is a
`‹ 3 / 92 ›` pager — and the real library runs 74–97 spine documents per book, so
finding a chapter means counting.

It also only opens EPUB, because it unzips the archive itself.

## Why Readium and not foliate-js

**There is no native EPUB renderer, on any platform.** Reflowable EPUB content is
XHTML and CSS, so every reader renders it in a web view. Readium's Swift
toolkit — the reference implementation — is no exception:
`Sources/Navigator/EPUB/EPUBReflowableSpreadView.swift` drives a `WKWebView` and
the package ships 30 injected JavaScript files including `index-reflowable.js`.

So the choice was never JS versus native. It is *whose* web-view wrapper we take,
and whether the API we write against is Swift or JavaScript. Readium wins on
three counts:

1. **It already implements the riskiest component.**
   `Sources/Navigator/EPUB/WebViewServer.swift` is a `WKURLSchemeHandler` that
   serves publication resources. The foliate-js design required us to write a
   Range-honouring scheme handler by hand, which was listed as the highest risk
   in that revision precisely because it works on a 1 MB EPUB and fails silently
   on a large archive. We no longer write it.
2. **Typography and themes become typed Swift.** `EPUBPreferences` exposes
   `fontSize`, `lineHeight`, `pageMargins`, `theme`, `fontFamily`, `columnCount`,
   `scroll`, `hyphens` and more, with an `EPUBPreferencesEditor` for building UI
   over them. Two of the four agreed controls stop being hand-injected CSS.
3. **PDF is real, and free.** Readium renders PDF natively. foliate-js needs
   `vendor/pdfjs` — 13 MB against a 2.9 MB app — for a path upstream itself calls
   "highly experimental".

The cost is dependency weight and one lost format; both are quantified below.

## Scope

**In:** pagination, typography controls, page themes, table of contents, a
progress readout, and support for `epub`, `pdf` and `cbz`.

**Out, deliberately:** in-book search, bookmarks and highlights (Readium supports
decorations, but they are not in this scope), a scrolled-mode toggle,
font-family choice, brightness. Audiobook playback is untouched — Readium ships
an audiobook navigator and we are **not** adopting it; the existing player stays.

**Blocked behind this:** the haptics work. Its page-turn trigger cannot be
specified until pages exist.

## The dependency

Swift Package Manager, not CocoaPods. CocoaPods is in maintenance mode and would
fight the XcodeGen-generated project; SPM is also what Readium recommends.

| | |
|---|---|
| Package | `https://github.com/readium/swift-toolkit` |
| Licence | BSD-3-Clause |
| Products needed | `ReadiumShared`, `ReadiumStreamer`, `ReadiumNavigator` |
| Products **not** needed | `ReadiumOPDS`, `ReadiumLCP` |
| Transitive packages | **9 resolved** — see below |

Pin an exact released version in `project.yml` under `packages:` — not a branch —
so a build is reproducible.

**Measured, not estimated.** Resolving 3.11.0 on macbuild fetches nine packages,
because SPM resolves the whole package graph even for products we do not link:
`SQLite.swift`, `Zip`, `GCDWebServer`, `ReadiumFuzi`, `DifferenceKit`,
`ReadiumZIPFoundation`, `SwiftSoup`, `CryptoSwift` — plus the toolkit itself.
Several of those belong to `ReadiumLCP` and `ReadiumOPDS`, which we do not take,
so the linked binary is narrower than the resolved graph; but CI pays for all
nine fetches. This is the honest downside versus vendoring: nine network fetches
at resolve time, and an app that no longer builds offline.

Verified on macbuild at commit `f3aea27`: the package resolves and
`xcodebuild` reports **BUILD SUCCEEDED** with the three products linked, so the
new CI failure surface is real but working.

**Delete the vendored foliate-js.** `apps/ios/Rawkoon/Reader/foliate-js/` and its
`VENDORED.md` were added for the previous revision (commit `e213d98`) and become
dead weight; remove the directory entirely.

## Format support

Rawkoon's `EbookFormat` is `epub | azw3 | mobi | pdf | cbz`
(`apps/shared/src/types/books.ts`). Readium covers three of the five, and PDF
properly.

| Format | Readium | Notes |
|---|---|---|
| `epub` reflowable | ✅ | Pagination, typography, themes |
| `epub` fixed-layout | ✅ | Pagination only |
| `pdf` | ✅ | Native, no 13 MB dependency |
| `cbz` | ✅ | Fixed layout; typography controls do not apply |
| `mobi`, `azw3` | ❌ | Not supported, not planned |

**Losing the Kindle formats costs nothing measurable here.** The library holds 7
`.mobi` files, every one a companion to a Harry Potter edition that also has a
`.epub`, and `ebookFormatRank` already prefers epub. Those rows keep a badge
saying the format cannot be opened; the book itself still opens.

Two consequences for the UI:

- **Typography and theme controls must hide for fixed-layout books** (`cbz`,
  pre-paginated `epub`, `pdf`), not sit there inert.
- **A `mobi`/`azw3`-only edition needs an honest "format not supported" state**,
  which is the one place the old *EPUB only* badge logic survives — rewritten to
  key on the unsupported set rather than on "is EPUB".

## Architecture

```
BookView / HomeView ──▶ EbookReaderSheet (SwiftUI)
                             │  local file URL, preferences, resume Locator
                             ▼
                    EPUBNavigatorViewController      (reflowable / fixed EPUB)
                    PDFNavigatorViewController       (pdf)
                    CBZNavigatorViewController       (cbz)
                             │  Readium owns the WKWebView, its injected JS,
                             │  and the WKURLSchemeHandler serving resources
                             ▼
                    NavigatorDelegate.locationDidChange(locator:)
                             │
                             ▼
                    AppModel.saveReadingPosition(_:)
```

**Opening a book** goes through the streamer: open the file as an `Asset`, parse
it into a `Publication`, then hand that to the navigator matching its media
type. The navigators are `UIViewController`s, so each is wrapped in a
`UIViewControllerRepresentable`; Readium documents a SwiftUI integration path
that the implementer should follow rather than invent.

**No scheme handler, no host HTML, no JS bridge.** All three disappear relative
to the previous revision.

## Reading position

Readium reports a `Locator` — `href`, `mediaType`, `title`, `text`, and
`locations` carrying `progression`, `totalProgression`, `position` and
`fragments`. It has a `jsonObject` representation, so it round-trips as JSON.

**Schema — done.** A nullable `locator TEXT` column holds the Locator JSON;
`spine_index` / `spine_path` / `spine_count` / `scroll_fraction` remain the
coarse fallback. The migration first landed on this branch named `cfi` and was
amended in place rather than renamed by a second migration, which was safe only
because it had never been deployed and the table has 0 rows in production. The
Prisma field, both shared types and the four route keys moved with it.

**Still to do on the client:** `ReadingPosition` in RawkoonKit needs the
`locator` field, added as the last init parameter with a `nil` default so
existing call sites and tests keep compiling, plus the two `APIClient` DTOs.

**Resolution order on open:** stored Locator if it parses → else spine
path/index plus fraction through the existing
`ReadingProgressReconciler.resolve` → else the start of the book.

**Progress readout comes free:** `locations.totalProgression` is percent through
the publication and `locations.position` is a page-ish index, so the agreed
readout needs no arithmetic of ours.

Keep the write path as it is: `AppModel.saveReadingPosition(_:)`, throttled to at
most one write per 3 seconds while reading, and always on dismiss. The locator
field is written unconditionally so it can never disagree with the spine fields
it accompanies — the same reasoning already recorded for `cfi`.

## Controls and UI

Settings are **global**, not per-book, persisted in `UserDefaults`, and applied
by submitting an `EPUBPreferences` to the navigator.

- **Typography:** `fontSize`, `lineHeight`, `pageMargins`.
- **Themes:** `theme` (Readium provides light / sepia / dark).
- **Table of contents:** `publication.tableOfContents` — a nested link tree.
  Render it in a sheet, current entry highlighted, tap to `go(to:)`.
- **Progress readout:** percent from `totalProgression`, page from `position`.
- **Page turns:** Readium handles taps and swipes; confirm its defaults before
  adding gestures of our own.

Fixed-layout and PDF publications hide the typography and theme controls.

## What gets deleted

The hand-rolled rendering layer becomes dead code. Its only consumer is
`EbookReaderView`.

| Path | Why |
|---|---|
| `Sources/RawkoonKit/ZipArchive.swift` | Readium reads the archive |
| `Sources/RawkoonKit/Inflate.swift` | ditto |
| `Sources/RawkoonKit/EpubPackage.swift` | Readium parses the publication |
| `Tests/RawkoonKitTests/EpubTests.swift` | tests the above |
| `Rawkoon/Reader/foliate-js/` | previous revision's engine |
| `FileStore.epubExtractionURL` + the extraction step | no extraction now |

Roughly 900 lines of Swift plus 296 KB of vendored JS. Downloading the file to
disk stays exactly as it is. `ReadingProgress.swift` and its tests **stay** — the
store and reconciler remain the position model.

Also in `BookView`: `isReadableEbook` is rewritten rather than deleted, because
`mobi`/`azw3` genuinely cannot be opened now.

## Testing, and an honest limit

This trades unit-testable pure Swift for a third-party navigator that RawkoonKit
cannot test. Deleting `EpubTests.swift` removes 20 of 58 kit tests, and `Inflate`
was the only non-trivial logic exercised on Linux in CI.

What replaces it:

1. **A compile gate on macbuild** — `swift test`, then `xcodebuild` for the
   simulator. Necessary, not sufficient. Linux cannot build the app target.
2. **Confirm SPM resolution works in CI**, which now fetches five packages. This
   is new failure surface for the `kit` and `build` jobs.
3. **A DEBUG smoke harness** over every ebook file in the real library —
   33 EPUBs — asserting each one opens and reports a locator. This is the closest
   thing to a regression test the design allows.
4. **A device pass** by the operator. Pagination quality, theme legibility and
   gesture feel cannot be judged from CI.

State that limit plainly in the PR rather than implying the feature is verified.

## Risks

| Risk | Mitigation |
|---|---|
| Nine resolved transitive packages; upstream tags can move | Pin an exact version, never a branch |
| CI must now resolve nine SPM packages | Confirmed working on macbuild before any reader code; watch the `kit` and `build` job times |
| Wrapping three `UIViewController` navigators in SwiftUI | Follow Readium's documented SwiftUI integration; do not invent one |
| `mobi`/`azw3` no longer openable | Honest unsupported-format state; every affected edition has an epub |
| Reader quality unverifiable in CI | Device pass, and say so in the PR |
| Readium is a large surface to adopt at once | Land it for reflowable EPUB first; `pdf` and `cbz` navigators can follow |
