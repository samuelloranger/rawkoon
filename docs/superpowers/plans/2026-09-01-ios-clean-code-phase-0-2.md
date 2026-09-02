# iOS clean-code milestone — phases 0→2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the in-flight audio fixes, finish the logging surface, and de-duplicate the formatters + download paths — the S-effort front of the clean-code milestone — with zero user-visible change.

**Architecture:** Merge #959's five reviewed fix commits first (phase 0). Then convert the download/playback `try?` discards to logged `catch` (phase 1). Then move the eight formatter copies into `RawkoonKit` under test — **preserving every distinct rendering, not collapsing them** — and route the three raw `URLSession.shared` downloads through a new `APIClient.downloadFile(path:)` that carries the bearer header, while keeping the existing user-facing error strings (phase 2).

**Tech Stack:** SwiftUI, iOS 18 target, Swift (RawkoonKit SPM package, Swift Testing / XCTest on Linux CI), `os.Logger`, `ByteCountFormatter`.

**Spec:** `docs/superpowers/specs/2026-09-01-ios-clean-code-milestone-design.md`

## Global Constraints

- **No user-visible behavior change** — layout, wording, and rendered strings identical to before. This is the phase's whole point.
- **macbuild ssh is the only real gate.** A green Linux `swift test` covers `RawkoonKit` only. Before any macbuild run: `git fetch -q origin && git checkout -q -B <branch> origin/<branch> && git log --oneline -1` — a stale checkout fakes `BUILD SUCCEEDED`.
- **Shippability = `lint` + `kit` + `build` green on the push to `main`.** No release, no version bump, no tag — publishing a release redeploys production. Not an agent's call.
- **No agent cuts a release.** #959 stays open for Sam's device pass regardless of green CI.
- `formatDuration` is pure arithmetic → exact-string assertions are safe on Linux. `formatBytes`/`formatSpeed` go through `ByteCountFormatter`, whose swift-corelibs-foundation output differs from Darwin's → assert **behavior** on Linux, capture exact strings on macOS only.
- Subsystem string `cloud.samlo.rawkoon` is a published log predicate — never change it.

---

## File structure

| File | Responsibility | Phase |
|---|---|---|
| `apps/ios/Sources/RawkoonKit/Formatters.swift` | **Create.** The six preserved formatter behaviors as pure functions. | 2 |
| `apps/ios/Tests/RawkoonKitTests/FormattersTests.swift` | **Create.** Behavior + (macOS-only) exact-string tests. | 2 |
| `apps/ios/Rawkoon/APIClient.swift` | **Modify.** Add `downloadFile(path:)`. | 2 |
| `apps/ios/Rawkoon/Views/MediaDetailView.swift` | **Modify.** Delete local formatters, call the kit. | 2 |
| `apps/ios/Rawkoon/Views/BookView.swift` | **Modify.** Delete local formatters + download, call the kit / APIClient. | 2 |
| `apps/ios/Rawkoon/Views/ContinueListeningView.swift` | **Modify.** Delete local formatter + download, call the kit / APIClient. | 2 |
| `apps/ios/Rawkoon/Views/ActivityView.swift`, `Views/DownloadClientView.swift`, `Views/DebugScreens.swift` | **Modify.** Delete local formatter / raw download, call the kit / APIClient. | 2 |
| `apps/ios/Rawkoon/ChapterDownloader.swift`, `Rawkoon/FileStore.swift` | **Modify.** `try?` discards → logged `catch`. | 1 |

---

## Task 1: Merge #959's reviewed fixes to main (Phase 0)

Not a TDD task — a gated integration. The five commits on `feat/ios-audio-session-and-car` are three review rounds' worth of real fixes (each fixed a bug the prior round's fix introduced). They must land intact; #959 then stays open for Sam.

**Files:** none created; merges `origin/feat/ios-audio-session-and-car` onto `origin/main`.

- [ ] **Step 1: Sync and confirm the delta is exactly the five commits**

```bash
cd apps/ios && git fetch -q origin
git log --oneline origin/main..origin/feat/ios-audio-session-and-car
# Expect exactly: 5204527, 803c1f8, 1c463a8, d2c9143, e6d0bdf
# (debc5a1 already merged as squash 847ce05 — must NOT reappear)
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --head feat/ios-audio-session-and-car \
  --title "fix(ios): land the reviewed audio-session interruption/seek fixes" \
  --body "Merges the five post-#60 review-round fixes (routes observer removed, interruption state machine hardened, seek-cancel-on-resume fixed, remote-command targets owned). CI did NOT exercise interruption resume, route disconnect, or steering-wheel buttons — those are simulator-proof and await Sam's in-car drive (#959)."
```

- [ ] **Step 3: Verify on macbuild at the merge-candidate sha**

Run on `macbuild`, after `git fetch && git checkout -B feat/ios-audio-session-and-car origin/feat/ios-audio-session-and-car && git log --oneline -1`:
```
swift test        # Expected: 72 tests, 0 failures
xcodebuild ... build   # Expected: BUILD SUCCEEDED
```

- [ ] **Step 4: Merge once green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Board — do NOT close #959**

Add a note to #959: five fixes merged at `<sha>`; open pending Sam's in-car drive test and the 10s rewind-floor decision. Leave status `in_progress`.

---

## Task 2: Download/playback `try?` discards → logged `catch` (Phase 1)

Turn silent failures on the diagnosis-critical path into `Log` lines. Only the sites where a failure is diagnostically meaningful — cleanup/removal/resource-value writes — not the read-guards that legitimately return nil.

**Files:**
- Modify: `apps/ios/Rawkoon/ChapterDownloader.swift:229`
- Modify: `apps/ios/Rawkoon/FileStore.swift:34`, `apps/ios/Rawkoon/FileStore.swift:59`
- No new test (these files are in the app target; no unit-test bundle exists until milestone phase 4). Verification is macbuild `build` green + reading the emitted log on a manual run.

**Interfaces:**
- Consumes: `Log.download`, `Log.playback` (already defined in `Rawkoon/Logging.swift`).

- [ ] **Step 1: `ChapterDownloader.swift:229` — log the failed cleanup**

Current:
```swift
try? fileManager.removeItem(at: destination)
```
Replace with:
```swift
do {
    try fileManager.removeItem(at: destination)
} catch CocoaError.fileNoSuchFile {
    // Already gone — nothing to clean up.
} catch {
    Log.download.error("Failed to remove partial chapter at \(destination.lastPathComponent, privacy: .public): \(error.localizedDescription, privacy: .public)")
}
```

- [ ] **Step 2: `FileStore.swift:34` — log the failed removal**

Current:
```swift
try? FileManager.default.removeItem(at: url)
```
Replace with:
```swift
do {
    try FileManager.default.removeItem(at: url)
} catch CocoaError.fileNoSuchFile {
    // Not present — treat delete as a no-op.
} catch {
    Log.download.error("Failed to remove file at \(url.lastPathComponent, privacy: .public): \(error.localizedDescription, privacy: .public)")
}
```

- [ ] **Step 3: `FileStore.swift:59` — log the failed resource-value write**

Current:
```swift
try? url.setResourceValues(values)
```
Replace with:
```swift
do {
    try url.setResourceValues(values)
} catch {
    Log.download.error("Failed to set resource values (exclude-from-backup) on \(url.lastPathComponent, privacy: .public): \(error.localizedDescription, privacy: .public)")
}
```

Leave the read-guards (`ChapterDownloader.swift:263-269`, `FileStore.swift:22`) as `try?` — a nil return is their designed control flow, not a swallowed error.

- [ ] **Step 4: Verify on macbuild**

`xcodebuild ... build` → Expected: `BUILD SUCCEEDED`. `swift test` still 72/0 (no RawkoonKit change).

- [ ] **Step 5: Commit**

```bash
git add Rawkoon/ChapterDownloader.swift Rawkoon/FileStore.swift
git commit -m "fix(ios): log download-path cleanup failures instead of discarding them"
```

---

## Task 3: Move the formatters into RawkoonKit, preserving every rendering (Phase 2a)

The eight copies are **not** interchangeable. Preserve all distinct behaviors as separate named functions; capture the current strings before deleting anything.

Distinct behaviors found (verbatim from source):

| Function | Callers | Behavior to preserve |
|---|---|---|
| duration "compact" | `MediaDetailView:872` | `Double?` → `String?`; `Int(seconds/60)` **truncates**; **unpadded** `\(remaining)m`; nil on non-finite/negative |
| duration "clock" | `ContinueListeningView:367`, `BookView:1192` | `Double` → `String`; `Int(seconds.rounded())`; **padded** `%02dm`; `"0:00"` on non-finite/≤0 |
| speed, useAll | `ActivityView:81`, `DownloadClientView:116` | `.binary`, `allowedUnits = [.useAll]`, `/s`, safe `Int64(exactly:)` |
| speed, default units | `MediaDetailView:1025` | `.binary`, **no** `allowedUnits`, `/s`, safe `Int64(exactly:)` |
| bytes "echo" | `MediaDetailView:867` | `String` → `String`; echoes raw on parse failure; `.file` |
| bytes "strict" | `BookView:1149` | `String?` → `String?`; nil when raw is nil or `Int64 ≤ 0`; `.file` |

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/Formatters.swift`
- Create: `apps/ios/Tests/RawkoonKitTests/FormattersTests.swift`

**Interfaces:**
- Produces (all in `enum Formatters`, called as `Formatters.x(...)`):
  - `static func durationCompact(_ seconds: Double?) -> String?`
  - `static func durationClock(_ seconds: Double) -> String`
  - `static func speed(_ bytesPerSecond: Double, useAll: Bool) -> String`
  - `static func bytesEcho(_ raw: String) -> String`
  - `static func bytesStrict(_ raw: String?) -> String?`

- [ ] **Step 1: Write the failing tests (behavior on Linux; exact strings macOS-only)**

`apps/ios/Tests/RawkoonKitTests/FormattersTests.swift`:
```swift
import Testing
@testable import RawkoonKit

struct FormattersTests {
    // durationCompact — pure arithmetic, exact strings safe on Linux
    @Test func compactTruncatesAndDoesNotPad() {
        #expect(Formatters.durationCompact(2 * 3600 + 5 * 60) == "2h 5m")   // unpadded
        #expect(Formatters.durationCompact(90) == "1m")
        #expect(Formatters.durationCompact(59) == "0m")                     // truncation
        #expect(Formatters.durationCompact(59.6) == "0m")                   // truncates — same input clock rounds up
    }
    @Test func compactRejectsInvalid() {
        #expect(Formatters.durationCompact(nil) == nil)
        #expect(Formatters.durationCompact(.nan) == nil)
        #expect(Formatters.durationCompact(.infinity) == nil)
        #expect(Formatters.durationCompact(-1) == nil)
    }
    // durationClock — pure arithmetic, exact strings safe on Linux
    @Test func clockPadsAndRounds() {
        #expect(Formatters.durationClock(2 * 3600 + 5 * 60) == "2h 05m")    // padded
        #expect(Formatters.durationClock(59.6) == "1m")                     // rounds up to a full minute
        #expect(Formatters.durationClock(0) == "0:00")
        #expect(Formatters.durationClock(.nan) == "0:00")
    }
    // bytes — assert BEHAVIOR only (ByteCountFormatter differs Linux vs Darwin)
    @Test func bytesEchoReturnsRawOnParseFailure() {
        #expect(Formatters.bytesEcho("not-a-number") == "not-a-number")
    }
    @Test func bytesStrictNilsOnNonPositiveOrNil() {
        #expect(Formatters.bytesStrict(nil) == nil)
        #expect(Formatters.bytesStrict("0") == nil)
        #expect(Formatters.bytesStrict("-5") == nil)
        #expect(Formatters.bytesStrict("1024") != nil)   // non-nil; exact string is platform-dependent
    }
    // speed — behavior only; non-finite must not trap
    @Test func speedIsSafeOnNonFinite() {
        #expect(Formatters.speed(.nan, useAll: true).hasSuffix("/s"))
        #expect(Formatters.speed(.infinity, useAll: false).hasSuffix("/s"))
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/ios && swift test --filter FormattersTests`
Expected: FAIL — `Formatters` undefined.

- [ ] **Step 3: Write `Formatters.swift` — each body copied verbatim from its source site**

`apps/ios/Sources/RawkoonKit/Formatters.swift`:
```swift
import Foundation

/// The app's shared, tested number/duration formatters. Each function preserves
/// exactly one pre-existing rendering — the copies they replace disagreed in
/// ways that reach the common case (padded vs unpadded minutes, rounding vs
/// truncation, echo vs nil on bad input), so they are kept distinct on purpose.
public enum Formatters {
    /// MediaDetailView rendering: truncating, unpadded, nil on invalid input.
    public static func durationCompact(_ seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds >= 0 else { return nil }
        let minutes = Int(seconds / 60)
        let hours = minutes / 60
        let remaining = minutes % 60
        if hours > 0 { return "\(hours)h \(remaining)m" }
        return "\(remaining)m"
    }

    /// ContinueListeningView / BookView rendering: rounding, zero-padded, "0:00" fallback.
    public static func durationClock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 { return "\(hours)h \(String(format: "%02dm", minutes))" }
        return "\(minutes)m"
    }

    /// `useAll: true` matches ActivityView/DownloadClientView; `false` matches MediaDetailView.
    public static func speed(_ bytesPerSecond: Double, useAll: Bool) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        if useAll { formatter.allowedUnits = [.useAll] }
        // Non-finite/overflowing rates would trap the non-failable Int64 init.
        let safeBytes = max(0, Int64(exactly: bytesPerSecond.rounded()) ?? 0)
        return "\(formatter.string(fromByteCount: safeBytes))/s"
    }

    /// MediaDetailView rendering: echoes the raw string when it does not parse.
    public static func bytesEcho(_ raw: String) -> String {
        guard let value = Int64(raw) else { return raw }
        return ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }

    /// BookView rendering: nil when absent or non-positive (callers then omit the metric).
    public static func bytesStrict(_ raw: String?) -> String? {
        guard let raw, let bytes = Int64(raw), bytes > 0 else { return nil }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/ios && swift test --filter FormattersTests`
Expected: PASS (all cases). Then full `swift test` → 72 + new = green.

- [ ] **Step 5: Replace the eight call sites, deleting each private copy**

In each file: add `import RawkoonKit` if absent, delete the private `func`, and update callers:
- `MediaDetailView.swift`: `formatBytes(x)` → `Formatters.bytesEcho(x)`; `formatDuration(x)` → `Formatters.durationCompact(x)`; `formatSpeed(x)` → `Formatters.speed(x, useAll: false)`.
- `ContinueListeningView.swift:367`, `BookView.swift:1192`: `formatDuration(x)` → `Formatters.durationClock(x)`.
- `BookView.swift:1149`: `formatBytes(x)` → `Formatters.bytesStrict(x)`.
- `ActivityView.swift:81`, `DownloadClientView.swift:116`: `formatSpeed(x)` → `Formatters.speed(x, useAll: true)`.

- [ ] **Step 6: Verify on macbuild — output byte-identical**

`swift test` green; `xcodebuild ... build` → `BUILD SUCCEEDED`. On the simulator, spot-check a 2h05m film shows `2h 5m` on the detail screen and `2h 05m` in Continue Listening — unchanged from before.

- [ ] **Step 7: Commit**

```bash
git add Sources/RawkoonKit/Formatters.swift Tests/RawkoonKitTests/FormattersTests.swift \
        Rawkoon/Views/MediaDetailView.swift Rawkoon/Views/BookView.swift \
        Rawkoon/Views/ContinueListeningView.swift Rawkoon/Views/ActivityView.swift \
        Rawkoon/Views/DownloadClientView.swift
git commit -m "refactor(ios): move the eight formatter copies into RawkoonKit under test"
```

---

## Task 4: Route the raw downloads through APIClient, preserving the error strings (Phase 2b)

Three views call `URLSession.shared.download` directly, bypassing the bearer header, the cookie-less session, and error mapping. Add one `APIClient` method and route them — **without** changing any string the user reads.

**Files:**
- Modify: `apps/ios/Rawkoon/APIClient.swift` (add `downloadFile`)
- Modify: `apps/ios/Rawkoon/Views/ContinueListeningView.swift:333`, `Rawkoon/Views/BookView.swift:1076`, `Rawkoon/Views/DebugScreens.swift:440`

**Interfaces:**
- Consumes: existing `makeRequest(path:method:requiresAuth:)`, `mapStatus(_:)`, the actor's `session`.
- Produces: `func downloadFile(path: String) async throws -> URL` — returns the on-disk temp URL of the downloaded body; throws `APIError` (`.unauthorized` on 401/403, `.http(status)` otherwise, `.transport` on transport failure).

- [ ] **Step 1: Add `downloadFile(path:)` to `APIClient`**

Insert near the other request helpers (after `perform`, ~line 425):
```swift
/// Authenticated file download. Carries the bearer header and the cookie-less
/// session, and maps HTTP status the same way as the JSON lane. Returns the
/// temporary file URL from URLSession; the caller owns moving it into place.
func downloadFile(path: String) async throws -> URL {
    let request = try makeRequest(path: path, method: "GET", requiresAuth: true)
    do {
        let (tempURL, response) = try await session.download(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.transport }
        guard (200 ..< 300).contains(http.statusCode) else { throw mapStatus(http.statusCode) }
        return tempURL
    } catch let error as APIError {
        throw error
    } catch {
        throw APIError.transport
    }
}
```

- [ ] **Step 2: Route `ContinueListeningView.openEbook` (line ~333) — preserve the displayed string**

Replace:
```swift
let (temporaryURL, response) = try await URLSession.shared.download(from: remoteURL)
guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
    throw APIError.transport
}
```
with a call that passes the content path and **keeps the old user-facing copy**. The view resolves `file.contentUrl` to a path today via `model.absoluteURL`; pass that same string to `downloadFile`, and re-map any thrown `APIError` back to `.transport` so `message(for:)` still renders "Network error. Check your connection." — the 401→"Sign in required." improvement is deliberately deferred to the localization phase:
```swift
let temporaryURL: URL
do {
    // NOTE: deliberately surfacing .transport for every failure here to preserve
    // the shipping copy ("Network error…"). The 401→"Sign in required." wording
    // improvement is deferred to the localization phase — see the milestone spec.
    temporaryURL = try await model.api().downloadFile(path: file.contentUrl ?? "")
} catch {
    Log.network.error("openEbook download failed: \(String(describing: error), privacy: .public)")
    throw APIError.transport
}
```
(Keep the subsequent `FileManager` move-into-place block unchanged.) This wires `Log.network`'s first call site.

- [ ] **Step 3: Route `BookView.ensureLocalEbookFile` (line ~1076)**

Same shape — the existing `catch` already maps to `"Download failed. Check your connection and try again."`, so simply swap the transport and let the existing catch stand (no string change):
```swift
let temporaryURL = try await model.api().downloadFile(path: file.contentUrl ?? "")
```
Delete the now-unused local `remoteEbookURL(for:)` only if it has no other caller (grep first); otherwise leave it.

- [ ] **Step 4: Route `DebugScreens` (line ~440)**

DebugScreens is developer-only; route it for consistency:
```swift
let temp = try await model.api().downloadFile(path: /* the same remote path string used today */)
```
Preserve whatever it does with `temp` afterward.

- [ ] **Step 5: Verify on macbuild**

`xcodebuild ... build` → `BUILD SUCCEEDED`. Error-path check using the HMAC-grant trick (corrupt the `grant` query param to force a 401): confirm the Continue Listening ebook-open failure still reads **"Network error. Check your connection."**, unchanged. Background downloads do not complete in the simulator, so verify the success path on a device or via the string capture only — do not gate on a simulator download completing.

- [ ] **Step 6: Commit**

```bash
git add Rawkoon/APIClient.swift Rawkoon/Views/ContinueListeningView.swift \
        Rawkoon/Views/BookView.swift Rawkoon/Views/DebugScreens.swift
git commit -m "refactor(ios): route cover/file downloads through APIClient, preserving error copy"
```

---

## Self-review

- **Spec coverage:** Phase 0 (merge #959) → Task 1. Phase 1 logging → Task 2 (+ `Log.network` wired in Task 4 Step 2, as the spec notes the call site lands with the download work). Phase 2a formatters → Task 3. Phase 2b downloads → Task 4. All four spec sub-phases have tasks.
- **Behavior preservation:** formatters keep all six renderings (Task 3 table); the 401 string is explicitly re-mapped (Task 4 Step 2). No visible change, per the global constraint.
- **Type consistency:** `Formatters.durationCompact/durationClock/speed/bytesEcho/bytesStrict` are named identically in the interface block, the tests, the implementation, and the call-site replacements. `downloadFile(path:) -> URL` matches between the interface block, the implementation, and all three call sites.
- **Placeholder scan:** no TBD/TODO; every code step carries the actual body. The one intentional "same remote path string used today" (Task 4 Step 4) is a developer-only debug screen whose exact source line the implementer reads in place — flagged, not hidden.
- **Honest limits:** Tasks 2 and 4 have no unit test because the app-target test bundle does not exist until milestone phase 4; both state build + manual/string-capture verification instead of pretending a test exists.
