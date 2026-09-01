# Phase 2: Shared formatters and network discipline - Research

**Researched:** 2026-09-01
**Domain:** Consolidating 8 duplicated pure-Swift formatting functions into `RawkoonKit` (Linux-tested SPM package), and routing 3 raw `URLSession.shared.download` call sites through the existing `APIClient` actor
**Confidence:** HIGH for all repo facts (every function body, call site, and API route quoted verbatim from a direct read this session); HIGH for the crash-bug findings (Swift `Int`/`Int64` non-finite-trap behavior is well-established language semantics, not something that needs a live run to establish); LOW/ASSUMED for the *exact rendered strings* `ByteCountFormatter` produces for the fixed input set (0, negative, 999/1000/1024) — this research host has no Swift toolchain (confirmed: `swift` not on `PATH`), so those strings can only be captured on `macbuild`, which is exactly what the roadmap's "Opens with" step already demands before deletion.

## Summary

This phase has two independent halves that happen to share one root cause: **duplication without a single source of truth let behavioral bugs diverge silently.** Reading all 8 formatter copies verbatim (not just grepping their signatures) surfaces a finding more serious than the roadmap's framing of "eight slightly-different private copies": **4 of the 8 copies will crash the app with a fatal error today if fed `.nan` or `.infinity`** — `Int(seconds / 60)` in `MediaDetailView.formatDuration` and `Int64(bytesPerSecond)` in all three `formatSpeed` copies are non-failable Swift initializers that **trap** on a non-finite `Double`, not silently misformat. This is not a parity question — KIT-01 explicitly requires the new shared functions to have tests covering non-finite input, and "preserve the crash" is not an available parity option. This must be planned as a **deliberate, documented fix**, not a port, and the plan's KIT-03 parity table must say so explicitly rather than silently "fixing" it and calling the row identical.

The two safe `formatDuration` copies (`ContinueListeningView:367`, `BookView:1192`) are byte-identical to each other and are the correct template to standardize on. The two `formatBytes` copies genuinely disagree on zero/negative handling (one returns the parsed formatter output for any `Int64`-parseable value including 0 and negatives; the other explicitly rejects anything `<= 0` and returns `nil`) and on what happens when the input string fails to parse (one echoes the raw string back, the other returns `nil`) — this is a real merge decision, not a formality.

For the parity capture the roadmap's "Opens with" step demands: the honest way to get real numbers is a small Swift script (`swift <file>.swift`, no Xcode project needed) run on `macbuild`, calling verbatim copies of the 5 *distinct* function bodies (not 8 — several are byte-identical) against the fixed input set, before any deletion. `ByteCountFormatter`'s exact output cannot be reasoned about from training data with acceptable confidence (zero-byte output is documented as `"Zero KB"`, but `.file` vs `.binary` countStyle rounding at the 999/1000/1024 boundary, and negative-count behavior, are not reliably documented) — and it matters doubly here because `RawkoonKitTests` runs on **Linux** in CI (`kit` job), where `swift-corelibs-foundation`'s `ByteCountFormatter` is a separate, historically incomplete reimplementation, not guaranteed to produce the same string as Darwin's ICU-backed formatter that actually ships to users. The recommended design keeps `ByteCountFormatter` (least behavior change, and `RawkoonKit.swift`'s own doc comment permits `Foundation` — it only bans `AVFoundation`/`UIKit`/`URLSession`/`SwiftData`), but the Linux test suite should assert *behavior* (non-crashing, correct nil-ness, monotonicity) for the two `ByteCountFormatter`-backed functions, while the macOS-only parity capture is the sole authority for *exact string* claims — because that is the platform whose Foundation implementation actually ships. `formatDuration` has no such problem: it is pure arithmetic and string interpolation, deterministic on every platform, so its tests can assert exact strings on Linux with no caveat.

For NET-01/02/03: the three call sites (`ContinueListeningView.swift:333`, `BookView.swift:1076`, `DebugScreens.swift:440` — line numbers have moved from the roadmap's planning-time numbers; located by content, not line, per plan-writing convention) are structurally identical — `URLSession.shared.download(from:)`, then a manual `HTTPURLResponse` status check, then a temp-file move. `APIClient` already has everything needed: an ephemeral, cookie-less `URLSession` (`APIClient.swift` init, confirmed read this session), a `makeRequest(path:method:requiresAuth:)` helper that attaches `Authorization: Bearer`, and a `mapStatus(_:)` helper that turns 401/403 into `.unauthorized` and everything else into `.http(status)`. No existing method fits — every current `APIClient` method uses `session.data(for:)`, none uses `session.download(for:)`. A single ~15-line actor method (`downloadFile(path:) async throws -> URL`) closes the gap by composing exactly those existing pieces. The server route these downloads hit (`/api/books/files/:fileId/content`) is **deliberately not behind `requireUser`** — confirmed by reading `bookPlaybackRoutes.ts` and its own comment: "background URLSession downloads send no session cookie, so session auth would 401 every valid background download." Auth is a signed, HMAC'd, 7-day `grant` query parameter instead; an invalid or tampered grant is what returns 401 today (`unauthorized(set, ...)` → `set.status = 401`). This gives a **concrete, deterministic way to force criterion 4's 401** without a debug harness or waiting a week: corrupt the `grant` query string on a real download URL.

The most important non-obvious finding for NET-03: fixing the typed-error mapping **will change a user-visible string**, and it needs to be named as a deliberate change, not silently absorbed. `BookView`'s ebook-download catch is a blanket `catch { ebookFilesError = "Download failed..." }` — any `APIError` case produces the same string, so no visible change there. But `ContinueListeningView.openEbook`'s catch **does** discriminate: `catch let error as APIError { errorMessage = message(for: error) }`, and `message(for:)` maps `.unauthorized` → `"Sign in required."`, `.http(404)` → `"No ebook files are available yet for this book."`, `.transport` → `"Network error. Check your connection."`. Today, the raw-`URLSession` download's non-2xx branch throws a hardcoded `APIError.transport` regardless of the real status — so a 401 currently surfaces as "Network error. Check your connection." After this phase correctly maps the status via `mapStatus`, the identical failure will surface as "Sign in required." This is exactly what criterion 4 asks for (a correctly *typed* error) and is a strict improvement, but it is a literal string change in `ContinueListeningView` specifically, and the phase's verification notes should record it as a deliberate, in-scope wording change rather than pretend nothing changed.

**Primary recommendation:** Add one file, `Sources/RawkoonKit/Formatters.swift`, with `formatBytes(_ bytes: Int64?) -> String?`, `formatDuration(_ seconds: Double) -> String`, and `formatSpeed(_ bytesPerSecond: Double) -> String`, each explicitly guarding non-finite/negative input before doing arithmetic (never trapping), with `RawkoonKitTests/FormattersTests.swift` covering the fixed input set using XCTest (matching all 11 existing test files' style — do not introduce Swift Testing here). Capture the pre-deletion baseline with a `macbuild`-run Swift script, not a guess. Add `APIClient.downloadFile(path:) async throws -> URL` as a ~15-line method reusing `makeRequest`/`mapStatus`, route all three call sites (including the `#if DEBUG`-only `DebugScreens.swift`, which the roadmap's literal grep still matches) through it, and add the phase's first `Log.network.error(...)` call on the non-2xx branch — `Log.network` exists (Phase 1) but has zero call sites today.

## Architectural Responsibility Map

Single-tier native client; no SSR/CDN tiers apply.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Byte/duration/speed formatting | `RawkoonKit` (pure logic, Linux+macOS SPM package) | App target (call sites only import and call) | This is the phase's own KIT-01 goal — one implementation, testable without a renderer or a device |
| Ephemeral, cookie-less HTTP session | `APIClient` actor | — | Already exists (Phase-0 design); this phase extends it, does not create a new session |
| Bearer-token attachment | `APIClient.makeRequest(requiresAuth:)` | — | Existing, reused as-is by the new `downloadFile` method |
| HTTP status → typed error mapping | `APIClient.mapStatus(_:)` | — | Existing, reused; today's 3 call sites hand-roll a weaker, lossy version of this (collapse everything to `.transport`) |
| Download-grant issuance and verification | Server (`downloadGrant.ts`, `bookPlaybackRoutes.ts`) | — | Out of this phase's scope; the client only needs to know a 401 is reachable by corrupting the grant, not how grants are signed |
| Failure diagnostics for network calls | `Log.network` (Phase 1's logging surface) | OS unified logging | `Log.network` exists but has **zero** call sites in the repo today — this phase is the first to use it |

## Project Constraints (from CLAUDE.md)

Both `./CLAUDE.md` (repo-wide) and `./.claude/CLAUDE.md` (milestone-specific) apply, as in Phase 1's own research. Directives load-bearing for this phase specifically:

- **No user-visible change, including wording**, until the localization phase — directly implicated by the `ContinueListeningView` finding above (fixing NET-03's typed-error mapping changes a shown string for a specific failure case). This is not a violation of the constraint if the plan documents it as the deliberate, in-scope consequence of NET-03 — but it must be documented, not silently absorbed, and it must be scoped to exactly this one call site (ContinueListeningView's 401/404 ebook-open path), not generalized into "fix all error messages while we're in here."
- **Verification**: `macbuild` is the only real gate; Linux CI (`kit` job) builds/tests `RawkoonKit` alone. This phase's core deliverable (the formatters) lives in `RawkoonKit`, so — unusually for this milestone — a green Linux `kit` run is meaningful evidence for KIT-01/02/03's *unit test* half; it is not evidence for the *rendered-string-in-the-app* half, which still needs `macbuild`.
- **No new third-party dependencies.** Nothing in this phase needs one — `ByteCountFormatter` and `URLSession` are both platform Foundation, already imported.
- **Build settings in `project.yml`, never `.xcodeproj`.** Not touched by this phase (no build-setting changes; `Sources/RawkoonKit/Formatters.swift` is picked up automatically by the existing SPM target glob, and `APIClient.swift`'s new method needs no target/scheme change).
- **No agent cuts a release.** Verification for this phase stops at `macbuild` `xcodebuild build`/manual simulator checks; do not propose a TestFlight upload as a gate.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KIT-01 | Byte, duration, and speed formatting exist once, in `RawkoonKit`, with unit tests covering zero, negative, non-finite, and boundary inputs | All 8 current bodies read verbatim and diffed below. 4 of 8 crash on non-finite input today (Swift `Int(Double)`/`Int64(Double)` trap on NaN/∞) — the new shared functions must guard this, which the roadmap's own test requirement makes non-optional. See Architecture Patterns and Common Pitfalls §1. |
| KIT-02 | All eight private copies deleted, call sites use the shared functions | Every call site enumerated with current file:line. See Architecture Patterns. |
| KIT-03 | Output strings unchanged, or every difference listed and deliberate | Divergences enumerated exactly (formatBytes zero/negative/parse-failure handling; formatDuration crash + zero-padding at the 3600s boundary; formatSpeed `allowedUnits` divergence). Mechanism for capturing the pre-deletion baseline given in Architecture Patterns — a `macbuild`-run Swift script, not a guess, because this research host has no Swift toolchain and `ByteCountFormatter`'s exact string output cannot be reliably assumed. |
| NET-01 | The three raw `URLSession.shared.download` calls go through `APIClient` | All three located by content this session (line numbers moved from roadmap's planning-time numbers): `ContinueListeningView.swift:333`, `BookView.swift:1076`, `DebugScreens.swift:440`. `DebugScreens.swift` is entirely `#if DEBUG`-wrapped but the roadmap's literal grep does not respect preprocessor conditionals and explicitly counts it among "today: three" — confirmed in scope. |
| NET-02 | Downloads carry the auth header and use the cookie-less ephemeral session | `APIClient`'s existing `makeRequest(requiresAuth: true)` does both already; the new `downloadFile` method just needs to call it. Note: the server route these hit does **not** require this header (grant-only auth, confirmed by reading `bookPlaybackRoutes.ts`) — sending it anyway is harmless and satisfies "matching every other request." |
| NET-03 | Failures surface as `APIError`, not an untyped `URLError` | Two distinct current bugs found: (1) transport-level failures (DNS, timeout) propagate as a raw, uncaught `URLError` today — genuinely violates NET-03 as literally worded; (2) HTTP-level failures are *already* caught and re-thrown as `APIError`, but always as the wrong case (`.transport`, hardcoded) instead of `mapStatus`'s correct case — fixing this changes a user-visible string in `ContinueListeningView` specifically (see Summary). `Log.network` (Phase 1, unused until now) is the logging target for criterion 4's "network-category log line naming the status." |
</phase_requirements>

## Standard Stack

No new third-party dependencies. This phase's only "stack" decisions are which existing Apple frameworks to keep using, and how to test them safely on two platforms.

### Core

| Component | Where | Purpose | Notes |
|-----------|-------|---------|-------|
| `ByteCountFormatter` | `Foundation`, already imported everywhere | Backs both `formatBytes` (all copies use `.file` countStyle) and `formatSpeed` (all copies use `.binary` countStyle) | [VERIFIED: apps/ios/Rawkoon/Views/BookView.swift:1149-1152, MediaDetailView.swift:867-869 — `.file` style; ActivityView.swift:81-87, DownloadClientView.swift:116-122, MediaDetailView.swift:1024-1027 — `.binary` style] Two genuinely different formatter configurations for two different domains (file size vs. transfer rate) — RawkoonKit should keep them as two distinct functions, matching KIT-01's own three-way naming (byte/duration/speed), not collapse into one "number of bytes" helper. |
| `XCTest` (`@testable import RawkoonKit`) | `Tests/RawkoonKitTests/*.swift` | Existing test style for all 11 current test files | [VERIFIED: apps/ios/Tests/RawkoonKitTests/BookTimelineTests.swift:1-2 — `@testable import RawkoonKit` / `import XCTest` / `final class BookTimelineTests: XCTestCase`] `.claude/CLAUDE.md`'s "Swift Testing is Apple's current default for new unit/integration tests" guidance targets the *new app-target* test bundle Phase 5 creates — it does not apply retroactively to `RawkoonKitTests`, an existing, working, XCTest-based target. New formatter tests should match their 11 siblings, not introduce a second test framework into one package. |
| `URLSession.download(for:) async throws -> (URL, URLResponse)` | `Foundation`, iOS 15+ | The async/await counterpart of `URLSession.shared.download(from:)`, callable on `APIClient`'s existing `session` property | No existing `APIClient` method uses this — all ~70 current endpoints use `session.data(for:)`. This is the one new primitive the phase needs. |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Keep `ByteCountFormatter` in `RawkoonKit` | Hand-roll a pure-Swift byte formatter (no Foundation formatter dependency) | Would guarantee identical output on Linux and Darwin (closing this phase's central risk outright), but would almost certainly NOT reproduce `ByteCountFormatter`'s exact current strings — trading a parity risk for a parity certainty-of-difference. Rejected: KIT-03 asks to preserve or explicitly document differences from *today's* output, and today's output is `ByteCountFormatter`'s; replacing the mechanism entirely maximizes surface area for undocumented differences rather than minimizing it. |
| `session.download(for:)` returning a `URL` | `session.data(for:)` returning `Data`, then `Data.write(to:)` | Would work, but doubles peak memory (holds the whole file in a `Data` buffer, unlike the current temp-file-then-move pattern) for what may be a multi-hundred-MB audiobook or ebook file. Rejected — no reason to regress this. |

## Package Legitimacy Audit

Not applicable — this phase adds zero new dependencies of any kind (no npm/pip/cargo/SPM/Homebrew packages). Every component used is either already in the app (Foundation, `APIClient`) or a pre-existing platform API (`URLSession.download(for:)`, available since iOS 15, no new import).

## Architecture Patterns

### All 8 current formatter bodies, read verbatim this session

**`formatSpeed` (3 copies):**

`ActivityView.swift:81-87` and `DownloadClientView.swift:116-122` are **byte-identical**:
```swift
private func formatSpeed(_ bytesPerSecond: Double) -> String {
    let formatter = ByteCountFormatter()
    formatter.countStyle = .binary
    formatter.allowedUnits = [.useAll]
    let formatted = formatter.string(fromByteCount: Int64(bytesPerSecond))
    return "\(formatted)/s"
}
```

`MediaDetailView.swift:1024-1027` **diverges** — no `allowedUnits` set (defaults to `.useDefault`, not `.useAll`):
```swift
private func formatSpeed(_ bytesPerSecond: Double) -> String {
    let formatter = ByteCountFormatter()
    formatter.countStyle = .binary
    return "\(formatter.string(fromByteCount: Int64(bytesPerSecond)))/s"
}
```
**All three** call `Int64(bytesPerSecond)` with **no `isFinite` or negativity guard anywhere**. `Int64(Double.nan)` and `Int64(Double.infinity)` are runtime traps in Swift (the non-failable `Int64.init(_: Double)` preconditions on the value being representable) — **all three current `formatSpeed` copies will crash the app** if given `.nan` or `.infinity`. Call sites: `DownloadClientView.swift:108-109` and `ActivityView.swift:71-72,143` (the latter is guarded — `ActivityView.swift:47`'s `speed.dlSpeed > 0 || speed.ulSpeed > 0` happens to exclude `.nan` because any comparison against NaN is `false` in Swift, but does **not** exclude `.infinity`, since `.infinity > 0` is `true`); `MediaDetailView.swift:964` has **no guard at all** before calling `formatSpeed(live.downloadSpeed)`. `dlSpeed`/`ulSpeed`/`downloadSpeed` are plain `Double` fields decoded from a download-client/indexer JSON response [VERIFIED: apps/ios/Rawkoon/Models.swift:377,385-386 — `let downloadSpeed: Double // bytes/s`, `let dlSpeed: Double`, `let ulSpeed: Double`] — a malformed or misbehaving external download-client API response is a real, not purely theoretical, way to hit this today.

**`formatDuration` (3 copies):**

`ContinueListeningView.swift:367-375` and `BookView.swift:1192-1200` are **byte-identical**:
```swift
private func formatDuration(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else { return "0:00" }
    let total = Int(seconds.rounded())
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    if hours > 0 {
        return "\(hours)h \(String(format: "%02dm", minutes))"
    }
    return "\(minutes)m"
}
```
Safe: guards `isFinite` and `> 0` before any `Int` conversion; zero, negative, NaN, and infinity all fall through to `"0:00"`.

`MediaDetailView.swift:872-880` **diverges completely** — different signature (optional in, optional out) and **no finiteness guard**:
```swift
private func formatDuration(_ seconds: Double?) -> String? {
    guard let seconds else { return nil }
    let minutes = Int(seconds / 60)
    let hours = minutes / 60
    let remaining = minutes % 60
    if hours > 0 {
        return "\(hours)h \(remaining)m"
    }
    return "\(remaining)m"
}
```
`Int(seconds / 60)` traps identically on `.nan`/`.infinity`. For `seconds = 0.0` (not `nil` — the guard only rejects the `Optional.none` case), this returns `"0m"`, not `"0:00"` — a real divergence from the other two even in the non-crashing case. For a negative input (e.g. `-100`), Swift's truncating-toward-zero `Int` division and its sign-preserving `%` produce `minutes = -1`, `hours = 0`, `remaining = -1`, yielding `"-1m"` — ugly but not a crash. **At the 3600s boundary specifically** (one of the roadmap's own fixed inputs): `minutes = 60`, `hours = 1`, `remaining = 0` → `"1h 0m"` — the safe pair produces `"1h 00m"` (zero-padded via `String(format: "%02dm", ...)`) for the identical input. This is a concrete, textual divergence at exactly the boundary the fixed input set was chosen to exercise. Call sites: `MediaDetailView.swift:733,773` — both wrapped in `if let duration = formatDuration(file.durationSecs)`, and `file.durationSecs: Double?` [VERIFIED: apps/ios/Rawkoon/Models.swift:179-180] is genuinely optional (server may omit it), so the `nil`-handling behavior is load-bearing, not incidental.

**`formatBytes` (2 copies):**

`MediaDetailView.swift:867-870` — non-optional in, non-optional out, falls back to echoing the raw string on parse failure, and does not reject non-positive values:
```swift
private func formatBytes(_ raw: String) -> String {
    guard let value = Int64(raw) else { return raw }
    return ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
}
```

`BookView.swift:1149-1152` — optional in, optional out, and **explicitly requires `bytes > 0`**:
```swift
private func formatBytes(_ raw: String?) -> String? {
    guard let raw, let bytes = Int64(raw), bytes > 0 else { return nil }
    return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
}
```
Real divergence, not cosmetic: for `raw = "0"` or a negative string, `MediaDetailView`'s copy calls `ByteCountFormatter` anyway (output unknown without a `macbuild` capture); `BookView`'s copy returns `nil`, and its callers (`if let size = formatBytes(...) { parts.append(size) }`, `BookView.swift:631,1137`) simply omit the metric from the joined string. For an unparseable string, `MediaDetailView`'s copy **returns the raw string verbatim** (e.g., a literal `"abc"` would render in the UI); `BookView`'s copy returns `nil` (metric omitted). Call sites: `MediaDetailView.swift:732,772` — unconditional `Text(formatBytes(file.sizeBytes))`, no `if let`, so its non-optional/echo-on-failure design is load-bearing to that call site's code shape, not an oversight. Both callers' `sizeBytes` fields are documented server-side as "bigint serialized as string" [VERIFIED: apps/ios/Rawkoon/Models.swift:250,571 — `let totalSizeBytes: String? // bigint serialized as string`, `let sizeBytes: String`] and are non-optional at the wire level in the common case, so the parse-failure branch is a defensive path unlikely to fire in practice — but the zero/negative-rejection divergence is real and will fire on legitimately empty files or (theoretically) a signed-integer overflow from the server.

### Recommended `RawkoonKit` signatures

The safe pair (`formatDuration`, `formatBytes`'s `nil`-returning discipline) should be the template, not the unsafe copies, because KIT-01's own test requirement makes "never crash" non-negotiable:

```swift
// Sources/RawkoonKit/Formatters.swift — new file
import Foundation

/// Byte, duration, and speed formatting, extracted from 8 near-duplicate
/// private copies across MediaDetailView, BookView, ActivityView,
/// DownloadClientView, and ContinueListeningView (phase 2 of the iOS
/// clean-code milestone). See 02-RESEARCH.md for the exact divergences this
/// consolidation resolves and which behavior (safe vs. crashing) was kept.
public enum Formatters {
    /// File/edition size. Mirrors BookView's contract (nil on parse failure
    /// or non-positive input), NOT MediaDetailView's (echo raw string,
    /// accept zero/negative) — the crash-free, nil-on-invalid contract is
    /// the one call sites can build correct optional-binding UI around.
    public static func formatBytes(_ bytes: Int64?) -> String? {
        guard let bytes, bytes > 0 else { return nil }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    /// Transfer/playback duration. Byte-identical logic to the two safe
    /// existing copies (ContinueListeningView/BookView) — this is a pure
    /// port, not a redesign.
    public static func formatDuration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(String(format: "%02dm", minutes))"
        }
        return "\(minutes)m"
    }

    /// Transfer rate. Guards non-finite/negative input BEFORE the Int64
    /// conversion — this is the fix for the crash present in all 3 existing
    /// copies, not a parity-preserving port.
    public static func formatSpeed(_ bytesPerSecond: Double) -> String {
        guard bytesPerSecond.isFinite, bytesPerSecond >= 0 else { return "0 B/s" }
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        formatter.allowedUnits = [.useAll]
        return "\(formatter.string(fromByteCount: Int64(bytesPerSecond)))/s"
    }
}
```

The exact fallback string for `formatSpeed`'s non-finite branch (`"0 B/s"` above) is a **placeholder, not a verified value** — pick whatever the `macbuild` baseline capture shows `ByteCountFormatter.string(fromByteCount: 0, ...)` actually renders (documented elsewhere as `"Zero KB"` for `.decimal`/`.binary` zero-byte formatting [CITED: multiple independent Swift-community sources cross-checked via WebSearch this session — not Apple's own docs, MEDIUM confidence], but `.binary` with `allowedUnits: .useAll` may render differently) and use that string literal directly, so the non-finite fallback matches what a literal `0` would already render, rather than inventing new UI text.

`formatBytes` taking `Int64?` instead of `String?` is a **signature change from every current call site** (all pass a `String`/`String?` bigint). This is deliberate: `KIT-01` asks for tests covering "negative" and "boundary" inputs as `Int64` values, and parsing belongs at the call site (which already has the raw string and the context to decide what an unparseable string means for its screen), not duplicated inside the shared formatter. Call sites become `Formatters.formatBytes(Int64(file.sizeBytes))` — one extra `Int64(...)` per call site, cheap, and it makes the *string-parsing* failure mode (today silently divergent between the two copies) visibly a call-site decision instead of a hidden formatter behavior.

### The mechanical parity-capture baseline (the roadmap's "Opens with" step)

There is no way to call a `private func` inside a SwiftUI `View` from outside that file, and `RawkoonKitTests` cannot import the app target at all (SPM package, no dependency on `Rawkoon`). The cheapest honest way to capture "what does each of the 5 *distinct* current bodies render for the fixed input set" before any deletion:

1. On `macbuild`, write a throwaway single-file Swift script (not a test, not an Xcode target — `swift some-file.swift` runs directly via the installed toolchain's interpreter, no project needed) containing verbatim copies of the 5 distinct bodies above (labelled by their real source, e.g. `mediaDetailFormatDuration`, `safeFormatDuration`, `mediaDetailFormatBytes`, `bookViewFormatBytes`, `formatSpeed` — the 3 `formatSpeed` copies collapse to effectively 2 behaviors given the `allowedUnits` divergence).
2. Call each with the fixed input set (`0, -100, .nan, .infinity, 999, 1000, 1024` for the byte/speed functions; `0, -100, .nan, .infinity, 59, 60, 3599, 3600` for the duration functions), print `"<label> <input> -> <output-or-'CRASH'>"` for each — wrapping the two known-crashing calls (`MediaDetailView`'s `formatDuration` and all `formatSpeed` copies against `.nan`/`.infinity`) needs care since a Swift trap is not a catchable Swift error; either run those specific cases in a separate process invocation per input (so a crash only loses that one line) or simply hand-document "traps, confirmed by direct code read, not by re-triggering the crash on macbuild" for those cells, since the crash is already established with HIGH confidence from the source alone.
3. Save the output as a committed table — recommended location: `apps/ios/docs/kit-formatter-parity.md` (new page, next to Phase 1's `log-retrieval.md`), with one row per (old call site, input) pair, an "old" column, a "new" column (filled in after the shared function lands), and a "deliberate?" column. This is the artifact Success Criterion 2 asks for ("the phase's verification notes carry a row per deleted call site giving the old and new rendered string").
4. After the shared functions land and call sites are migrated, re-run the same fixed input set against `Formatters.formatBytes/formatDuration/formatSpeed` (this time as an actual `RawkoonKitTests` XCTest, on both Linux and — once, manually — `macbuild`, to confirm the two platforms don't silently disagree) and fill in the "new" column.

This keeps the Linux CI test suite (`kit` job, gates every PR) asserting **behavior**, not asserting a `ByteCountFormatter` string this research cannot responsibly promise is identical to Darwin's — see Common Pitfalls §2.

### `APIClient.downloadFile` — the one new network primitive

```swift
// APIClient.swift — new method, alongside the other ~70 endpoint methods
/// Downloads a file (ebook content, currently) to a temporary location and
/// returns that location. Callers MUST move the file before their next
/// `await` — URLSession does not guarantee the temp file survives past the
/// current suspension point (see 02-RESEARCH.md Common Pitfalls).
func downloadFile(path: String) async throws -> URL {
    let request = try makeRequest(path: path, method: "GET", requiresAuth: true)
    do {
        let (tempURL, response) = try await session.download(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.transport }
        guard (200 ..< 300).contains(http.statusCode) else {
            Log.network.error(
                "File download failed: path=\(path, privacy: .public) status=\(http.statusCode, privacy: .public)"
            )
            throw mapStatus(http.statusCode)
        }
        return tempURL
    } catch let error as APIError {
        throw error
    } catch {
        throw APIError.transport
    }
}
```

This mirrors `perform()`'s existing catch shape exactly (`APIError` passthrough, everything else collapses to `.transport`) — that `catch` block is what closes NET-03's "not as a raw `URLError`" gap: today, a transport-level failure (DNS, timeout, connection reset) from `URLSession.shared.download(from:)` propagates uncaught out of `ensureLocalEbookFile`, since neither `BookView` nor `ContinueListeningView` wraps the `try await` in its own transport-error catch — it is a genuine, literal `URLError` reaching the caller's outer `catch` today. `path` is logged (safe — it is the API route, e.g. `/api/books/files/123/content`), but the `grant` query parameter it carries is a signed, time-limited credential; **do not log the full `path` string if it is ever changed to include the raw grant value inline via string interpolation without the existing route-only prefix** — as written above, `path` is the full string including `?grant=...`, which **would** leak the grant into logs. The plan should log a grant-stripped path (e.g., split on `?` before interpolating, or log a `URLComponents`-parsed path-without-query) — this is the direct analogue of Phase 1's own established rule ("never log a signed, time-limited grant," documented for `ManifestChapter.url` in `01-RESEARCH.md`) and should be treated as load-bearing, not optional, given LOG-03 is already a shipped, gating requirement from Phase 1.

Call sites become, e.g. (`BookView.ensureLocalEbookFile`):
```swift
guard let client = model.api() else { throw APIError.unauthorized }
guard let contentPath = file.contentUrl else { throw EbookStorageError.missingRemoteURL }
let tempURL = try await client.downloadFile(path: contentPath)
// ...same FileManager move logic as today, unchanged...
```
Note this **removes** the `model.absoluteURL(...)` resolution step entirely — `APIClient.makeRequest` already resolves `path` against its own `baseURL`, and `file.contentUrl` is always a same-origin relative path with a grant (confirmed server-side: `bookEditionRoutes.ts:180`, never an absolute external URL) — so `EbookStorageError.missingRemoteURL`/`EbookContinueError.missingRemoteURL` (thrown today when `contentUrl` is `nil`) stay exactly as-is, just gated on `contentUrl == nil` instead of `model.absoluteURL(contentUrl) == nil`. This is a strictly smaller check (fewer ways to fail), so it cannot introduce a new failure mode.

### Forcing a real 401 for Criterion 4 — a concrete, deterministic mechanism

The server route (`bookPlaybackRoutes.ts:135-166`, read in full this session) is **intentionally not behind `requireUser`**:
> "Signed grants are the only auth. Intentionally no requireUser: background URLSession downloads send no session cookie, so session auth would 401 every valid background download."

Auth is a `grant` query parameter — an HMAC-signed, JSON payload (`fileId`, `variant`, `grantId`, `expiresAt`), 7-day TTL [VERIFIED: apps/ios/../apps/api/src/routes/books/bookEditionRoutes.ts:21 — `const EDITION_FILE_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;`]. An invalid or tampered grant returns 401 via `verifyGrant` failing and the route calling `unauthorized(set, "Invalid or expired download grant")` [VERIFIED: apps/api/src/errors.ts:13-16 — `set.status = 401`]. **Waiting 7 days is not practical**; the deterministic alternative is to corrupt the `grant` value on a real `contentUrl` before the request goes out (append a character, or swap in another file's grant) — this reaches the exact same `verifyGrant` failure path a real expired grant would, with an identical 401 response, and requires no debug harness, no synthetic manifest, and no waiting. Recommend the plan add a temporary, reverted-after-verification one-line edit (or a `#if DEBUG` toggle gated behind an env var, matching the existing `DebugScreens.swift` pattern) that corrupts the grant on the outgoing request, run once on `macbuild`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Byte/speed formatting | A hand-rolled `if bytes > 1024*1024*1024 { ... }` ladder | `ByteCountFormatter` (kept, per Alternatives Considered above) | Already correctly handles locale, pluralization, and unit-name localization; a hand-rolled ladder would need to solve all of that itself for zero benefit, and would guarantee a `KIT-03` parity break rather than avoid one |
| HTTP status → typed error | A second, weaker `if (200..<300)... else { .transport }` inline at each of the 3 call sites (today's actual state) | `APIClient.mapStatus(_:)` (existing, reused) | This is literally what NET-03 is asking to stop doing — the duplication here is structurally identical to the KIT-01 formatter duplication, just in the network layer instead of the view layer |
| Temp-file-to-permanent-location move after a download | Nothing new — this logic (`createDirectory`, remove-if-exists, `moveItem`) is unchanged in all three call sites and should stay unchanged | — | Out of this phase's scope; the only thing changing is how the temp file is obtained (`APIClient.downloadFile` vs. raw `URLSession.shared.download`), not what happens to it afterward |

**Key insight:** both halves of this phase are "stop duplicating something that already exists correctly once" — `RawkoonKit` already has 10 files of exactly this pattern (pure logic, tested on Linux) to extend into, and `APIClient` already has the session/auth/status-mapping pattern to extend into. Neither half requires inventing a new mechanism, only relocating and (for the formatters) fixing a real crash bug uncovered along the way.

## Common Pitfalls

### Pitfall 1: "preserve current behavior" is not achievable for 4 of the 8 copies, and the plan must say so explicitly

**What goes wrong:** A parity-first reading of KIT-03 ("output strings are unchanged... or every difference is listed and deliberate") could be mistaken for "never change behavior," leading someone to try to reproduce `Int(Double.nan)`'s crash inside the new shared function to stay "identical."

**Why it happens:** The roadmap's own fixed input set for the parity capture literally includes `.nan` and `.infinity` — which only makes sense if the intent is to discover and fix exactly this class of bug, not preserve it. A crash is not a "string that could be compared row-by-row" in a parity table; there is no cell to fill in for "the app terminated."

**How to avoid:** Treat every non-finite/negative input to `formatSpeed` (all 3 copies) and `MediaDetailView`'s `formatDuration` as a deliberate, documented **fix**, not a port. The parity table's row for these cells should read something like "OLD: crashes (traps on `Int(Double.nan)`, confirmed by code read) / NEW: `0 B/s` (or whichever fallback string is chosen) / DELIBERATE: yes — crash is not a preservable behavior, and KIT-01 requires a passing test for exactly this input."

**Warning signs:** A plan or PLAN.md that describes the new formatters as "a straight port" without calling out the crash fix is under-describing its own diff.

### Pitfall 2: `ByteCountFormatter` output is not guaranteed identical between the Linux CI test run and the Darwin runtime that ships to users

**What goes wrong:** Writing a `RawkoonKitTests` case that asserts `Formatters.formatBytes(1024) == "1 KB"` (or whatever exact string is observed) and treating a green Linux `kit` run as proof the app will render that same string on a real device.

**Why it happens:** `swift-corelibs-foundation` (Linux's Foundation reimplementation) has a documented history of gaps and non-parity with Darwin's Foundation for exactly this class of ICU-backed formatter [CITED: `swift-corelibs-foundation` GitHub issue tracker, cross-checked this session — "Missing APIs in CoreLibs Foundation" names `ByteCountFormatter.copy()` specifically as unimplemented, and multiple platform-specific `ByteCountFormatter.swift` build issues are on record; MEDIUM confidence — documented gaps exist, but this research cannot enumerate every string-level divergence without running both platforms side by side]. `Package.swift` targets `.macOS(.v14)` as well as Linux, so `swift test` *can* be run on `macbuild` too — but the roadmap's own "Definition of done" only requires the Linux `kit` job green, which is silent on this risk.

**How to avoid:** For `formatBytes`/`formatSpeed` (the two `ByteCountFormatter`-backed functions), write Linux-run tests that assert **behavior** — correct `nil`-ness, no crash, output contains the expected unit suffix or is non-empty, monotonic ordering across the boundary inputs — rather than an exact string literal. Reserve exact-string assertions for `formatDuration` (pure arithmetic, provably identical on every platform) and for the macOS-only manual/`macbuild` parity capture, which is the actual authority for what ships. Note this explicitly in the plan so a future contributor doesn't "strengthen" the Linux tests into exact-string assertions and inadvertently make `kit` red on a Linux Foundation update that has nothing to do with this app's own code.

**Warning signs:** A `FormattersTests.swift` with `XCTAssertEqual(Formatters.formatBytes(999), "999 bytes")`-style literal assertions for the byte/speed functions, with no accompanying note about which platform that literal was captured on.

### Pitfall 3: the temp file from `session.download(for:)` must be moved before the next suspension point, not "soon"

**What goes wrong:** Adding any `await` (a second network call, an `AppModel` method, a `Task.sleep`, etc.) between `client.downloadFile(path:)` returning and the caller's `FileManager.default.moveItem(at:to:)` call.

**Why it happens:** `URLSession`'s async `download(for:)` variant does not keep the returned temporary file alive indefinitely — it is only guaranteed to exist through the current suspension boundary, the direct async analogue of the older delegate-based API's "move it before the delegate callback returns" rule [CITED: cross-referenced community documentation of `URLSession.download(for:)`'s async variant this session; the exact wording of the guarantee is not in a single canonical Apple statement, so treat as MEDIUM confidence on the precise boundary, HIGH confidence on the practical rule "move immediately, no intervening awaits"].

**How to avoid:** All three current call sites already follow this discipline (temp URL obtained, then an unbroken chain of *synchronous* `FileManager` calls, no `await` in between) — the refactor's job is to preserve that exact shape, just swapping the source of the temp URL. Do not "clean up" the surrounding code to add an intervening `await` (e.g., an extra `AppModel` progress update) in the same edit.

**Warning signs:** Any diff that adds a new `await` between the `downloadFile` call and the `moveItem` call in the same function.

### Pitfall 4: `DebugScreens.swift`'s `#if DEBUG` wrapping does not exempt it from Criterion 3's grep

**What goes wrong:** Treating `DebugScreens.swift` as out of scope because it never ships to TestFlight/production (confirmed: the entire 467-line file is one `#if DEBUG` ... `#endif` block).

**Why it happens:** It's tempting to reason "this code never runs for a real user, so a raw `URLSession.shared` call there carries none of NET-02's auth/session risk in production."

**How to avoid:** The roadmap's Success Criterion 3 is a literal, textual `grep -rn 'URLSession.shared' apps/ios/Rawkoon/Views` with an explicit expected count (today: three, naming `DebugScreens` as one of them) — `grep` does not evaluate `#if`/`#endif`, so the check will still find it, and the roadmap's own accounting already counts it. Migrate `DebugScreens.swift:440`'s call too.

**Warning signs:** A plan that migrates only 2 of the 3 call sites with a rationale like "the third is debug-only."

### Pitfall 5: fixing NET-03's error-typing correctly changes a user-visible string in `ContinueListeningView`, and that is in scope, not a regression to avoid

**What goes wrong:** Worrying that NET-03 conflicts with the "no user-visible change" milestone constraint, and either (a) declining to fix the status-mapping bug to avoid the string change, or (b) fixing it but not documenting the change, risking it being flagged as an unintended regression during verification.

**Why it happens:** `ContinueListeningView.openEbook`'s `catch let error as APIError { errorMessage = message(for: error) }` already discriminates on `APIError` case — it was written expecting a correctly-typed error, but the raw-`URLSession` download code beneath it has always thrown a hardcoded `.transport` regardless of the real HTTP status. The bug is that `ensureLocalEbookFile` was never taught to `throw mapStatus(status)`. Fixing it (which is exactly what NET-03 requires) means a 401 now correctly says "Sign in required." instead of "Network error. Check your connection." — a real, observable text change for one specific failure path.

**How to avoid:** Document this explicitly as an intentional consequence of NET-03 in the phase's verification notes, scoped to exactly the ebook-content-download 401/404 failure path in `ContinueListeningView`. Do not extend "while we're in here" fixes to any other error message in either view — `BookView`'s equivalent catch is a blanket, non-discriminating `catch`, so the identical fix there produces **no** visible change (confirmed by reading `BookView.swift`'s `downloadEbook`), and should not be given a matching message-discrimination upgrade in this phase, since that widening is out of NET-03's literal scope.

**Warning signs:** A verification report that describes NET-03 as achieving "zero user-visible change" without naming this one exception, or a plan that also adds new discriminating error messages to `BookView` "for consistency."

## Runtime State Inventory

Not applicable — this is a code-consolidation and refactor phase, not a rename/rebrand/data-migration phase. No stored data, service config, OS-registered state, secret names, or build-artifact names change. Confirmed nothing to migrate: the new `RawkoonKit.Formatters` enum and `APIClient.downloadFile` method are pure additions; no existing type, key, or identifier is renamed.

## Code Examples

See **Architecture Patterns** above for the full `Formatters.swift` skeleton, the `APIClient.downloadFile` method, the grant-corruption approach to forcing a live 401, and the parity-capture script's shape — all grouped there since each is tightly coupled to the finding it addresses.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| 8 private, independently-drifted formatter copies, 4 with a real crash bug on non-finite input | 1 tested `RawkoonKit.Formatters` enum, crash-free by construction | This phase | Closes a real, currently-live crash vector (a misbehaving download-client/indexer API response with `.nan`/`.infinity` speed would crash `ActivityView`, `DownloadClientView`, or `MediaDetailView` today) |
| 3 raw `URLSession.shared.download` calls, one of which lets a transport-level failure escape as an untyped `URLError` | `APIClient.downloadFile`, reusing the existing auth/session/status-mapping pipeline | This phase | First real exercise of `Log.network` (Phase 1 built the category, never used it) |

**Deprecated/outdated:** none — no library or API version changes in this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ByteCountFormatter.string(fromByteCount: 0, ...)` renders as `"Zero KB"` (or a similarly non-numeric string) rather than `"0 KB"`/`"0 bytes"` | Standard Stack, Architecture Patterns (formatSpeed's non-finite fallback) | If wrong, the chosen fallback string for `formatSpeed`'s non-finite guard is cosmetically off from what a literal zero renders — low severity (both are placeholder-quality UI text for an edge case), but should be corrected against the actual `macbuild` capture before the plan locks a literal string |
| A2 | `URLSession.download(for:)`'s async-await temp file is only guaranteed to survive through the current suspension boundary, not indefinitely, matching the delegate-based API's "move before returning" rule | Common Pitfalls §3 | If the real guarantee is looser (e.g., survives until the enclosing `Task` completes), the pitfall is overcautious but harmless — the recommended discipline (move immediately, no intervening `await`) is safe either way since it's what the current code already does |
| A3 | `ByteCountFormatter`'s exact rendered strings for the fixed input set (0, negative, 999/1000/1024) cannot be responsibly asserted from training knowledge and require a `macbuild` capture | Summary, Architecture Patterns (parity capture) | This is treated as a hard requirement (a Wave-0-style prerequisite), not really an assumption at risk — flagged here so the plan doesn't skip the capture step believing this research already supplies the numbers |
| A4 | `swift-corelibs-foundation`'s `ByteCountFormatter` may diverge from Darwin's for at least some inputs, based on documented API gaps, not a directly observed side-by-side string diff | Common Pitfalls §2 | If Linux and Darwin actually agree for every input this phase's tests exercise, the recommendation to avoid exact-string Linux assertions is more conservative than strictly necessary — but the cost of that conservatism is low (behavioral tests are still meaningful), while the cost of being wrong the other way (asserting exact strings that later diverge on a Foundation update) is a spuriously red `kit` job unrelated to any app-code change |

**If this table is empty:** N/A — see above.

## Open Questions

### 1. What exact fallback string should `formatSpeed`'s new non-finite/negative guard return?

**What we know:** The three current copies never had one (they crash instead), so there is no "current behavior" to preserve — this is a genuinely new decision, not a parity question. `ByteCountFormatter.string(fromByteCount: 0, countStyle: .binary)` with `allowedUnits: .useAll` is documented elsewhere (community sources, not Apple's own docs) as rendering `"Zero KB"`-style output for a literal zero, which suggests a consistent fallback would be `"\(formatter.string(fromByteCount: 0))/s"` (reuse the formatter's own zero-rendering) rather than a hand-picked literal like `"0 B/s"`.

**What's unclear:** the exact string, and whether `.useAll` changes the zero-case wording from `.decimal`'s `"Zero KB"`.

**Recommendation:** Capture `ByteCountFormatter.string(fromByteCount: 0, countStyle: .binary)` with `allowedUnits: .useAll` on `macbuild` as part of the same parity-capture pass (Architecture Patterns), and use that exact string (with `/s` appended) as the guard's fallback — keeping the non-finite case visually consistent with "the app already knows how to render zero," rather than inventing new UI text.

### 2. Should `RawkoonKit.formatBytes` take `Int64?` (a signature change from every call site) or keep the `String`/`String?` signature to minimize the diff?

**What we know:** Every current call site passes a `String` (server sends "bigint as string"). A `String`-taking shared function would need to embed one of the two current, disagreeing parse-failure policies (echo-raw-string vs. `nil`) inside `RawkoonKit` itself, re-creating exactly the kind of hidden divergence this phase exists to remove.

**What's unclear:** whether the milestone's "the split is a move... not a redesign" philosophy (stated explicitly for API-01/02 in Phase 5, and implicitly the spirit of KIT-02's "call sites call the shared functions") extends to forbidding a signature change here too.

**Recommendation:** Take `Int64?`, per Architecture Patterns above — KIT-01 explicitly asks for tests over "negative" and "boundary" `Int64`-shaped inputs, which reads as an `Int64` (or similar numeric) parameter being the intended contract, and pushing string-parsing back to call sites makes the previously-silent divergence (echo vs. `nil`) a visible, reviewable one-line decision at each of the (now) 2 call sites rather than a third hidden behavior inside the shared function.

## Environment Availability

| Dependency | Required By | Available (this research host) | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Swift toolchain | Everything in this phase — writing/running the parity-capture script, `swift test` | ✗ (confirmed via `command -v swift`, not found) | — | All capture/verification happens on `macbuild`, per this milestone's standing constraint — expected, not a gap |
| `apps/api` source (for confirming server-side grant/auth behavior) | Understanding why NET-02's "auth header" is a no-op for the server but still correct client-side hygiene | ✓ (same monorepo, read directly this session) | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | XCTest via SwiftPM, `RawkoonKit`/`RawkoonKitTests` — same as all 11 existing test files [VERIFIED: apps/ios/Tests/RawkoonKitTests/BookTimelineTests.swift:1-2] |
| Config file | `apps/ios/Package.swift` |
| Quick run command | `cd apps/ios && swift test` (Linux-safe; runs the new `FormattersTests.swift` alongside the existing 72) |
| Full suite command | Same — this phase adds no app-target tests (that is Phase 5's TEST-01/TEST-02); NET-01/02/03's behavior lives entirely in the app target, verified manually on `macbuild`, not by an automated test this phase can add |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KIT-01 | `formatDuration` exact-string correctness for zero/negative/non-finite/boundary | unit (Linux-safe, exact string) | `swift test --filter FormattersTests` | ❌ — new file this phase |
| KIT-01 | `formatBytes`/`formatSpeed` non-crashing + correct nil-ness/shape for zero/negative/non-finite/boundary | unit (Linux-safe, behavioral only — see Pitfall 2) | `swift test --filter FormattersTests` | ❌ — new file this phase |
| KIT-02/03 | All 8 old call sites now call the shared functions; rendered strings match the captured baseline or are documented deviations | manual + `grep` | `grep -rn 'private func format\(Bytes\|Duration\|Speed\)' apps/ios/Rawkoon` (expect 0 hits); manual screenshot comparison on `macbuild` simulator per the captured baseline table | N/A — inherently a code/screenshot review, not an automatable test |
| NET-01 | Zero raw `URLSession.shared` sites remain in `Views/` | `grep` | `grep -rn 'URLSession.shared' apps/ios/Rawkoon/Views` (expect 0 hits) | N/A |
| NET-02/03 | A corrupted-grant download surfaces `APIError` + a `network`-category log line naming the status; a healthy download still succeeds | manual, on `macbuild` simulator | Corrupt the `grant` query param on a real `contentUrl`, attempt an ebook download, confirm `errorMessage`/`ebookFilesError` renders (and, for `ContinueListeningView`, that it says "Sign in required." not "Network error."); separately confirm `xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"'` shows a `Log.network.error` line naming `status=401` | N/A — no app-target test harness exists until Phase 5 |

### Sampling Rate

- **Per task commit:** `cd apps/ios && swift test` (fast, Linux-safe, exercises the new `FormattersTests.swift`)
- **Per wave merge:** full `macbuild` sequence (`swift test` + `xcodegen generate` + `xcodebuild build`) plus the manual grant-corruption/network-log verification and the screenshot-vs-baseline comparison
- **Phase gate:** roadmap's own "Definition of done" — Linux `kit` green, `macbuild` `xcodebuild build` green at the verified HEAD sha, no user-visible change (with the one documented, scoped exception in `ContinueListeningView` per Pitfall 5)

### Wave 0 Gaps

- [ ] `Sources/RawkoonKit/Formatters.swift` — doesn't exist, created this phase
- [ ] `Tests/RawkoonKitTests/FormattersTests.swift` — doesn't exist, created this phase
- [ ] `apps/ios/docs/kit-formatter-parity.md` — doesn't exist; must be populated via the `macbuild`-run capture script **before** any of the 8 private copies are deleted (this is the roadmap's literal "Opens with" instruction)
- [ ] `APIClient.downloadFile(path:)` — doesn't exist, created this phase
- [ ] No app-target unit test framework exists yet (Phase 5) — NET-01/02/03's live behavior is verified manually on `macbuild`, not via an automated test this phase can write

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | No — not touched (token issuance unchanged) | — |
| V4 Access Control | Marginal — the download-grant model (server-side, out of scope) is what this phase's new client code interacts with, not what it changes | Client only needs to send the grant-bearing `contentUrl` unmodified and add the (server-optional but consistent) bearer header |
| **V7 Error Handling and Logging** | **Yes — the core of NET-03/criterion 4** | Never log the full `path` string once it carries a `?grant=...` query parameter — strip the query before interpolating into `Log.network`, per Phase 1's already-shipped LOG-03 precedent for `ManifestChapter.url` |
| V5 Input Validation | No new inputs — `Int64?`/`Double` formatter parameters have no attacker-controlled trust boundary beyond what already exists (server-decoded JSON) | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Logging a signed, time-limited download grant in cleartext | Information Disclosure | Strip the query string from `path` before any `Log.network` interpolation in the new `downloadFile` method — this is the single concrete new logging call site this phase adds, and it is the one most likely to accidentally leak a credential if written carelessly (see Architecture Patterns' `downloadFile` code example and its inline caution) |
| A crash-on-malformed-input DoS from an untrusted/misbehaving download-client or indexer API response (`.nan`/`.infinity` speed value) | Denial of Service | This is precisely what the `formatSpeed` rewrite fixes — guard `isFinite`/non-negative before any `Int64` conversion |

## Sources

### Primary (HIGH confidence — read directly this session)

- This repository: `apps/ios/Rawkoon/Views/{MediaDetailView,BookView,ActivityView,DownloadClientView,ContinueListeningView,DebugScreens}.swift` (all 8 formatter bodies, all 3 `URLSession.shared` call sites, verbatim, with line numbers), `apps/ios/Rawkoon/APIClient.swift` (full session-config/`makeRequest`/`perform`/`mapStatus` read), `apps/ios/Rawkoon/AppModel.swift` (`api()`, `absoluteURL`), `apps/ios/Rawkoon/Models.swift` (`BookEditionFile`, size/duration field types), `apps/ios/Rawkoon/Logging.swift` (confirmed `Log.network` exists with zero call sites), `apps/ios/Sources/RawkoonKit/*.swift` (existing pattern, `RawkoonKit.swift`'s Linux-compatibility doc comment), `apps/ios/Tests/RawkoonKitTests/BookTimelineTests.swift` (existing test style), `apps/ios/Package.swift` (platforms, language mode), `apps/api/src/routes/books/bookPlaybackRoutes.ts` and `bookEditionRoutes.ts` (grant issuance/verification, `requireUser` scoping, TTL), `apps/api/src/services/books/downloadGrant.ts` (`signGrant`/`verifyGrant`), `apps/api/src/errors.ts` (`unauthorized` → 401)
- `.planning/ROADMAP.md` (Phase 2 section), `.planning/REQUIREMENTS.md` (KIT-01..03, NET-01..03), `.planning/PROJECT.md`, `.planning/phases/01-.../01-RESEARCH.md` and `01-VERIFICATION.md` (prior-phase conventions, `Log` category ownership, the Simulator-background-URLSession limitation this phase's foreground async downloads are distinguished from)

### Secondary (MEDIUM confidence — WebSearch, cross-checked, not this repo)

- `ByteCountFormatter` zero-byte output (`"Zero KB"`) and `.decimal`/`.binary` unit-threshold semantics — multiple independent Swift-community sources, not Apple's own reference docs directly
- `swift-corelibs-foundation` `ByteCountFormatter` gaps — GitHub issue tracker for `swiftlang/swift-corelibs-foundation`
- `URLSession.download(for:)` async-variant temp-file-lifetime discipline — community documentation cross-referenced, not a single canonical Apple statement

### Tertiary (LOW confidence)

- None asserted as fact without a confidence caveat attached in-line above.

## Metadata

**Confidence breakdown:**
- Formatter divergences and the non-finite crash bug: HIGH — every body read verbatim this session; the crash claim rests on well-established, non-platform-specific Swift language semantics (`Int`/`Int64` non-failable initializers trap on NaN/∞), not on a live run
- `APIClient`/server-route findings (grant-only auth, 401 mechanism, `Log.network` unused): HIGH — read directly from both the iOS and API source this session
- Exact `ByteCountFormatter` rendered strings for the fixed input set: LOW/deferred — correctly flagged as needing a `macbuild` capture, not guessed
- Linux-vs-Darwin `ByteCountFormatter` parity risk: MEDIUM — documented API gaps exist, but no side-by-side string diff was run this session

**Research date:** 2026-09-01
**Valid until:** 2026-10-01 (30 days) for anything version-sensitive (none here, no new dependencies); repo-fact findings (line numbers, exact bodies, route behavior) are valid until the next commit touches those files — re-verify at plan time if significant time has passed.
