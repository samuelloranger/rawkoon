# Phase 2: Shared formatters and network discipline - Pattern Map

**Mapped:** 2026-09-01
**Files analyzed:** 6 new/modified Swift files (1 new `RawkoonKit` source, 1 new test file, 1 `APIClient` method, 4 view call-site edits, 1 doc), plus a "no precedent" check on a throwaway capture script
**Analogs found:** 6 / 6 direct, all path-tracked-source verified with `git ls-files`

All paths named below are tracked source — verified individually below or by the git-blame-visible content already quoted in `02-RESEARCH.md` (same session, same files).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/ios/Sources/RawkoonKit/Formatters.swift` (new) | utility (pure functions) | transform | `apps/ios/Sources/RawkoonKit/SmartRewind.swift` (free function, `isFinite`-guard shape) + `ChapterFilter.swift`/`ContextMenuItems.swift` (top-level `public func`, no wrapping type) | exact — same package, same "no state, no wrapping type needed" shape |
| `apps/ios/Tests/RawkoonKitTests/FormattersTests.swift` (new) | test | transform | `apps/ios/Tests/RawkoonKitTests/SmartRewindTests.swift` | exact — same package, same boundary/non-finite-input test shape KIT-01 asks for |
| `apps/ios/Rawkoon/APIClient.swift` — new `downloadFile(path:)` method | service (actor method) | file-I/O (download) | `APIClient.manifest(editionId:)` (lines 249-266) for the makeRequest→await→status-check→typed-throw shape; `APIClient.perform(_:)` (lines 413-425) for the catch-shape to copy since `download(for:)` bypasses `perform` entirely | role-match — same actor, same helpers, but no existing method calls `session.download(for:)`; this is a genuinely new call, composed from existing pieces, not a copy of one method |
| `ContinueListeningView.swift:333` (call site) | view (async func in a `View`) | file-I/O | itself, post-edit — replaces the manual `URLSession.shared.download` + status-check block with `client.downloadFile(path:)` | exact — same file, same function, narrower body |
| `BookView.swift:1076` (call site) | view | file-I/O | same as above, `BookView`'s own `ensureLocalEbookFile` | exact |
| `DebugScreens.swift:440` (call site, `#if DEBUG`) | view (debug-only) | file-I/O | same pattern, inside the existing `#if DEBUG` block — no structural change to the conditional | exact |
| 8 deleted private formatter copies across `MediaDetailView`/`BookView`/`ActivityView`/`DownloadClientView`/`ContinueListeningView` | view (private helper) | transform | replaced by `import RawkoonKit` + `Formatters.formatBytes/Duration/Speed(...)` calls | n/a — deletion, not a pattern to copy |
| `apps/ios/docs/kit-formatter-parity.md` (new) | docs | — | `apps/ios/docs/log-retrieval.md` (phase 1) and `apps/ios/docs/code-quality-audit.md` | exact — same directory, same H1+context-paragraph convention |
| Throwaway `macbuild` capture script | script (one-off) | batch | none in-repo | no analog — see "No Analog Found" |

## Pattern Assignments

### `apps/ios/Sources/RawkoonKit/Formatters.swift` (new file)

**Dominant convention in `RawkoonKit`, established by reading all 5 named files plus 2 more (`ChapterFilter.swift`, `ContextMenuItems.swift`):** the package does **not** have one uniform shape — it mixes free top-level `public func`s and `public struct`/`enum` types with static/instance members, chosen per file based on whether there is state to carry:

- **Free top-level function, no wrapping type** — `SmartRewind.swift:13` (`public func smartRewindOffset(pausedFor seconds: Double) -> Double`), `ChapterFilter.swift:10` (`public func filterChapters(_ chapters: [ManifestChapter], query: String) -> [ManifestChapter]`), `ContextMenuItems.swift:13` (`public func mediaPosterMenuItems(inLibrary: Bool, isAdmin: Bool) -> [MediaPosterMenuAction]`). This is the convention for a single pure transform with no related sibling functions worth grouping.
- **`public struct ... : Sendable` with instance members** — `BookTimeline.swift:12` (`public struct BookTimeline: Sendable { public let chapters... public func chapterIndex(...) }`), used when there's a natural piece of state (a chapter list) the functions operate over.
- **`public enum ... : Sendable` for value cases** (not a namespace) — `DownloadPlan.swift:3-9` (`ChapterState`), `9-17` (`DownloadEvent`), `ContextMenuItems.swift:3-7` (`MediaPosterMenuAction`) — these are data, not utility holders.
- **`public enum` as a bare namespace with only a static let** — `RawkoonKit.swift:5-7` (`public enum RawkoonKit { public static let name = "RawkoonKit" }`), mirrors Phase 1's `Logging.swift`/`FileStore.swift` "enum as static-only namespace" idiom, but this is the package-identity marker, not a precedent for grouping unrelated functions.

**Recommendation for `Formatters.swift`:** `RESEARCH.md`'s own draft groups the three functions under `public enum Formatters { static func ... }` — this matches the `FileStore.swift`/`Logging.swift` namespace idiom (Phase 1's own analog) and is defensible since the three functions are one cohesive "presentation formatting" concern, closer to a related trio than any of the single-function files above. But note: **there is no existing `RawkoonKit` file that groups multiple *unrelated-state* pure functions under one enum namespace** — the closest actual precedent for "three sibling static functions with no shared state" doesn't exist in this package yet. If the planner prefers matching the *majority* convention (5 of 7 non-trivial files are free top-level functions with no wrapping type), three top-level `public func formatBytes(...)`, `public func formatDuration(...)`, `public func formatSpeed(...)` at file scope is equally defensible and arguably the stronger analog match. Either is consistent with *some* file in the package; state this as an open choice in the plan rather than treating `enum Formatters` as an established convention it is not yet.

**Non-finite guard convention to copy** (`SmartRewind.swift:13`):
```swift
public func smartRewindOffset(pausedFor seconds: Double) -> Double {
    guard seconds.isFinite, seconds > 0 else { return 0 }
    ...
}
```
This exact `guard <value>.isFinite, <value> > 0 else { return <safe-default> }` shape at the top of the function, before any arithmetic, is the established idiom for guarding a `Double` input in this package — copy it verbatim for `formatDuration`/`formatSpeed`, matching what the two safe existing view-layer copies already do (`ContinueListeningView.swift:367`, `BookView.swift:1192`, quoted in full in `02-RESEARCH.md` lines 111-121).

**Doc-comment convention to copy** (`BookTimeline.swift:2-11`, `SmartRewind.swift:2-11`): a `///` doc comment above the declaration that states *why* the function exists and what would go wrong without its specific guard/design choice — not a generic "formats bytes" one-liner. E.g. `BookTimeline.swift`'s comment explains why a whole-book offset was chosen over a file-index+offset pair by naming the concrete bug it prevents. `Formatters.formatBytes`'s doc comment should similarly name why it takes `Int64?` and returns non-optional `String` (per CONTEXT.md D-2 — "so the missing-value case is explicit at each call site," not "formats a byte count").

**Import discipline to copy** (`RawkoonKit.swift:3-4`): every file in this package opens with `import Foundation` only — the package-level rule ("must never import AVFoundation, UIKit, URLSession or SwiftData... built and tested on Linux") is stated once in `RawkoonKit.swift` and implicitly binding on every sibling file. `Formatters.swift` needs only `import Foundation` (for `ByteCountFormatter`), nothing else — matches every other file in the package.

---

### `apps/ios/Tests/RawkoonKitTests/FormattersTests.swift` (new file)

**Analog:** `apps/ios/Tests/RawkoonKitTests/SmartRewindTests.swift` (full file, quoted above) — closest match because it is the one existing test file covering a pure numeric formatter/transform with an explicit non-finite-input test case, exactly what KIT-01 asks for.

**Structural convention to copy** (`SmartRewindTests.swift:1-4`):
```swift
@testable import RawkoonKit
import XCTest

final class SmartRewindTests: XCTestCase {
```
`@testable import RawkoonKit` before `import XCTest`, `final class <Name>Tests: XCTestCase` — identical shape across all 11 existing test files (also confirmed in `BookTimelineTests.swift:1-3`). No Swift Testing `@Test` anywhere in this package — do not introduce it here (matches `02-RESEARCH.md`'s own explicit call-out).

**Naming convention for test methods:** `test<Scenario>` in camelCase describing the input class, not the input value — e.g. `testShortPauseRewindsNothing`, `testNonsensicalDurationsRewindNothing` (`SmartRewindTests.swift:5,26`), `testExactBoundaryBelongsToTheFollowingChapter` (`BookTimelineTests.swift:33`). Group multiple boundary values inside one test method via multiple `XCTAssertEqual` calls rather than one test-per-value — `SmartRewindTests.testShortPauseRewindsNothing` asserts three inputs (0, 3, 9.99) in one method. This is the table-driven substitute this codebase uses (no parametrized-test framework, no `XCTestCase` data-provider pattern found anywhere in the 11 files) — `FormattersTests.swift` should follow the same shape: one test per input *class* (zero, negative, non-finite, each unit boundary), multiple asserted values per test.

**Non-finite test to copy nearly verbatim** (`SmartRewindTests.swift:24-29`):
```swift
/// A clock that jumped backwards, or an uninitialised timestamp, must not
/// produce a negative rewind — that would seek forwards past the pause.
func testNonsensicalDurationsRewindNothing() {
    XCTAssertEqual(smartRewindOffset(pausedFor: -5), 0)
    XCTAssertEqual(smartRewindOffset(pausedFor: .nan), 0)
    XCTAssertEqual(smartRewindOffset(pausedFor: .infinity), 0)
}
```
This is the direct template for `formatDuration`'s and `formatSpeed`'s non-finite/negative test cases — same three inputs (`-5`-class negative, `.nan`, `.infinity`), same doc-comment convention explaining the real-world scenario the guard protects against (here: a misbehaving download-client API, per `02-RESEARCH.md`'s `Models.swift:377,385-386` finding).

**Per Pitfall 2 in RESEARCH.md**, `formatBytes`/`formatSpeed` tests (both `ByteCountFormatter`-backed) should assert **behavior** (non-nil-ness where expected, non-crash, monotonic ordering, or "contains a digit"/"ends in expected unit"), not an exact string literal — reserve exact-string `XCTAssertEqual` for `formatDuration`, which is pure arithmetic. `BookTimelineTests.swift:22` (`XCTAssertEqual(timeline.totalDurationSecs, 1995.049796, accuracy: 1e-9)`) demonstrates this package's existing convention for asserting a computed `Double` with an explicit `accuracy:` tolerance where floating-point comparison is involved — reuse `accuracy:` if `formatSpeed`'s intermediate `Double` math needs a tolerant check before string conversion.

---

### `apps/ios/Rawkoon/APIClient.swift` — new `downloadFile(path:)` method

**Analog for the request-then-status-check shape:** `manifest(editionId:)` (`APIClient.swift:249-266`, read verbatim):
```swift
func manifest(editionId: Int) async throws -> BookManifest {
    let request = try makeRequest(
        path: "/api/books/editions/\(editionId)/manifest",
        method: "GET",
        requiresAuth: true
    )
    let (data, response) = try await perform(request)
    guard (200 ... 299).contains(response.statusCode) else {
        throw mapStatus(response.statusCode)
    }
    ...
}
```
Copy the shape: `try makeRequest(path:method:requiresAuth: true)`, then a status-range guard that throws `mapStatus(...)` on failure. **Deviation required:** `manifest` calls the shared `perform(_:)` helper (which wraps `session.data(for:)`), but `downloadFile` must call `session.download(for:)` directly — `perform` cannot be reused as-is because it returns `(Data, HTTPURLResponse)`, not a temp-file `URL`. The new method therefore needs to **inline** `perform`'s catch shape rather than call it.

**Analog for the catch shape to inline:** `perform(_:)` itself (`APIClient.swift:413-425`):
```swift
private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    do {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport
        }
        return (data, http)
    } catch let error as APIError {
        throw error
    } catch {
        throw APIError.transport
    }
}
```
This `catch let error as APIError { throw error } catch { throw APIError.transport }` two-arm catch is the one and only place in `APIClient.swift` that distinguishes "already-typed" from "raw/transport" errors — it is the exact mechanism NET-03 needs (today's 3 view-level call sites lack any such distinction, per `02-RESEARCH.md`'s finding that a raw `URLError` escapes uncaught). `downloadFile` should reproduce this same two-arm shape around its own `session.download(for:)` call, swapping the payload type from `Data` to a temp `URL`.

**Analog for the status-mapping helper (reused as-is, not copied):** `mapStatus(_:)` (`APIClient.swift:435-440`):
```swift
private func mapStatus(_ status: Int) -> APIError {
    switch status {
    case 401, 403: return .unauthorized
    default: return .http(status)
    }
}
```
Call directly — no changes needed, this is the single source of truth NET-03 asks the 3 call sites to route through instead of their own hand-rolled `.transport`-only mapping.

**Analog for `makeRequest` (reused as-is):** `makeRequest(path:method:requiresAuth:)` (`APIClient.swift:395-410`) already attaches the `Authorization: Bearer` header when `requiresAuth: true` and resolves `path` against `baseURL` — this closes NET-02 with zero new code; `downloadFile` just needs to call it with `requiresAuth: true`.

**No existing method uses `session.download(for:)`** — confirmed by the earlier grep across all ~70 `APIClient` methods (every one uses `get`/`post`/`patch`/`perform`, all backed by `session.data(for:)`). This is a first-of-its-kind call in this file; `manifest`'s request-building/status-check shape plus `perform`'s catch shape are the two halves to compose, not a single method to port wholesale.

**Log call-site convention** (new — `Log.network` has zero call sites today, per `02-RESEARCH.md`): follow Phase 1's `01-PATTERNS.md` "Privacy-first logging" shared pattern — `Log.network.error("...", privacy: .public)` on numeric/status fields, and per Security Domain in RESEARCH.md, strip the `grant` query parameter from `path` before interpolating (do not reuse `ChapterDownloader.swift`'s convention of logging `fileId`/`status` only, never a URL — same rule applies here for the exact same reason: `path` here also carries a signed grant).

---

### Call-site edits: `ContinueListeningView.swift:333`, `BookView.swift:1076`, `DebugScreens.swift:440`

**RawkoonKit already imported in all six views that will lose a formatter** (`grep -n "import RawkoonKit"` this session): `ContinueListeningView.swift:1`, `MediaDetailView.swift:1`, `BookView.swift:2`, plus `Components.swift:1`, `LibraryView.swift:1`, `MiniPlayerView.swift:1`, `PlayerView.swift:3`, `EbookReaderView.swift:2`, `DebugScreens.swift:2` (the latter inside its own `#if DEBUG` gate). `ActivityView.swift` and `DownloadClientView.swift` were **not** in that grep's hit list — confirm at plan time whether they need a new `import RawkoonKit` line added (their two `formatSpeed` copies are being deleted and replaced with `Formatters.formatSpeed(...)`, which requires the import). Do not assume it is already there for those two files.

**Deletion pattern:** each `private func format<X>(...)` block (line ranges cited in Classification above) is deleted outright, and every call site within the same file is rewritten to call `Formatters.format<X>(...)` (or bare `format<X>(...)` if the planner chooses the free-function shape) with the CONTEXT.md D-2 signature change (`formatBytes` callers now wrap the raw string in `Int64(...)` before calling, since the shared function takes `Int64?` not `String`/`String?`).

**Download-call deviation:** the three `URLSession.shared.download(from: remoteURL)` sites (`BookView.swift:1076`, `ContinueListeningView.swift:333`, `DebugScreens.swift:440`) each already have their own manual `HTTPURLResponse` status check and temp-file move immediately following — per Pitfall 3 in `02-RESEARCH.md`, only the *source* of the temp `URL` changes (from `URLSession.shared.download(from:)` to `client.downloadFile(path:)`); the synchronous `FileManager` move logic directly below stays untouched, with no new `await` inserted between the two.

---

### `apps/ios/docs/kit-formatter-parity.md` (new doc)

**Analog:** `apps/ios/docs/log-retrieval.md` (phase 1's own new doc, itself modeled on `code-quality-audit.md` per `01-PATTERNS.md`'s own mapping) and `code-quality-audit.md` directly.

**Heading/opening convention to copy** (per `01-PATTERNS.md`'s own citation of `code-quality-audit.md:1-4`):
```markdown
# <Title> — <date>

<one paragraph of scope/context, no YAML front matter>
```
`# <Title> — <date>` as H1 (e.g. `# iOS formatter parity capture — 2026-09-01`), followed immediately by one prose paragraph stating what this document is and why it exists (per `code-quality-audit.md`'s own opening: states what was audited and against which commit) — for this doc: which 5 distinct formatter bodies were captured, on which host (`macbuild`), against which commit sha, before which deletion. No YAML front-matter block — confirmed absent in both existing `apps/ios/docs/` files. Body should use a table (per `code-quality-audit.md`'s LOC table convention, `01-PATTERNS.md` line 233) with one row per (old call site, input) pair and `old`/`new`/`deliberate?` columns, exactly as `02-RESEARCH.md`'s own Architecture Patterns section (parity-capture step 3) specifies.

---

### Throwaway `macbuild` capture script

**No precedent found.** `apps/ios/scripts/` contains exactly two files, both permanent tooling, not throwaway captures: `asc-app-status.ts` and `asc-distribute.mjs` — both Node/TypeScript (App Store Connect automation), neither Swift, neither a one-off. There is no existing `.swift` script file anywhere in the repo (confirmed: `Sources/`, `Tests/`, and `Rawkoon/` are all part of a package/Xcode target, never a bare `swift <file>.swift`-run script). This capture script is genuinely new territory with no in-repo shape to match — `02-RESEARCH.md`'s own recommendation (a single-file, uncommitted-or-briefly-committed Swift file run via `swift somefile.swift` on `macbuild`, output captured into the new doc, the script itself discarded or not added to `apps/ios/scripts/`) should stand as-is. If the plan wants it committed for reproducibility rather than discarded, `apps/ios/scripts/` is the nearest *location* precedent even though the *language* (Swift vs. the two existing TS files) is a first for that directory — note this explicitly rather than implying an established Swift-script convention exists there.

## Shared Patterns

### Non-finite `Double` guard (RawkoonKit-wide)
**Source:** `SmartRewind.swift:13` (`guard seconds.isFinite, seconds > 0 else { return 0 }`)
**Apply to:** `Formatters.formatDuration`, `Formatters.formatSpeed` — copy this exact guard-first shape before any arithmetic or `Int64(...)` conversion, since this is precisely the fix for the 4-of-8 crash bug `02-RESEARCH.md` identified.

### XCTest shape (RawkoonKitTests-wide)
**Source:** `SmartRewindTests.swift` (whole file), `BookTimelineTests.swift:1-3`
**Apply to:** `FormattersTests.swift`
`@testable import RawkoonKit` / `import XCTest` / `final class <Name>Tests: XCTestCase`, one `test<Scenario>` method per input class grouping multiple boundary values, doc comments on tests that guard against a named real-world failure mode.

### `APIClient` request → status-check → typed-throw (APIClient-wide)
**Source:** `manifest(editionId:)` (`APIClient.swift:249-266`), `perform(_:)` (`APIClient.swift:413-425`), `mapStatus(_:)` (`APIClient.swift:435-440`)
**Apply to:** `downloadFile(path:)`
`makeRequest(path:method:requiresAuth:)` → await the session call → status-range guard → `throw mapStatus(status)` on failure; wrap the whole await in `do { ... } catch let error as APIError { throw error } catch { throw APIError.transport }` so a transport-level failure never escapes as a raw `URLError` (closing NET-03's literal gap).

### Privacy-first logging (carried from Phase 1, first real use here)
**Source:** `01-PATTERNS.md`'s "Privacy-first logging" shared pattern; `ChapterDownloader.swift`'s existing `Log.download.error(...)` call (quoted in `01-PATTERNS.md`) as the closest concrete example of "log status/id fields, never a signed URL"
**Apply to:** `downloadFile`'s non-2xx branch — `Log.network.error("... status=\(status, privacy: .public)")`, with `path`'s query string (the `grant` parameter) stripped before interpolation, exactly as `ChapterDownloader.swift` already refuses to log `ManifestChapter.url`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Throwaway Swift capture script (`macbuild`-run) | script | batch | `apps/ios/scripts/` holds only Node/TypeScript App-Store-automation scripts (`asc-app-status.ts`, `asc-distribute.mjs`); no bare `.swift`-run script exists anywhere in the repo. Closest neighbour by location only, not by language or by "throwaway" intent. |
| `public enum Formatters` as a grouping namespace for 3 unrelated-state pure functions | utility | transform | No existing `RawkoonKit` file groups multiple sibling pure functions under one enum purely for organization — the package's actual precedent is either one free function per file (`SmartRewind.swift`, `ChapterFilter.swift`, `ContextMenuItems.swift`) or a struct/enum wrapping genuine state (`BookTimeline`, `DownloadPlan`). `RESEARCH.md`'s own `enum Formatters` draft is a reasonable choice but is not yet an established convention — flag this as an open choice for the planner, not a settled pattern. |

## Metadata

**Analog search scope:** `apps/ios/Sources/RawkoonKit/*.swift` (all 10 files, 5 read in full this session, 2 more read for confirmation — `ChapterFilter.swift`, `ContextMenuItems.swift`), `apps/ios/Tests/RawkoonKitTests/{SmartRewindTests,BookTimelineTests}.swift`, `apps/ios/Rawkoon/APIClient.swift` (targeted reads: lines 62-100, 249-270, 395-467, 543 for the full method-name inventory), `apps/ios/Rawkoon/Views/{ContinueListeningView,BookView,DebugScreens,MediaDetailView,ActivityView,DownloadClientView}.swift` (grep for `URLSession.shared`, `private func format*`, `import RawkoonKit` — line numbers cross-checked against `02-RESEARCH.md`'s own citations, not re-read where already quoted verbatim there), `apps/ios/docs/` (directory listing), `apps/ios/scripts/` (directory listing), `apps/ios/.swiftlint.yml`, `apps/ios/.swiftformat` (both read in full).
**Files scanned:** 6 new/modified deliverables classified; 12 analog source files read or grep-confirmed this session.
**Pattern extraction date:** 2026-09-01
