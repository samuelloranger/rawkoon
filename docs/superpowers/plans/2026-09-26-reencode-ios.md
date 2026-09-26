# Re-encode Queue iOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins full parity with the web re-encode feature in the iOS app: a re-encode sheet from file / season / whole title, a Home card with live progress, and a Settings admin screen for the queue and history.

**Architecture:** Native SwiftUI views that call the existing `/api/transcode/*` endpoints through a new `APIClient+Transcode.swift`, with DTOs in `Models+Transcode.swift`. Live data is polled while a screen is visible. Pure logic (bitrate math, box fit, HH:MM, drag-to-move translation) lives in the `RawkoonKit` Swift package so it is unit-tested with `swift test`.

**Tech Stack:** Swift 6 (strict concurrency, default MainActor isolation), SwiftUI (iOS 26.2 / Mac Catalyst), Swift Testing, XcodeGen, SwiftFormat, SwiftLint.

**Spec:** `docs/superpowers/specs/2026-09-26-reencode-ios-design.md`

## Global Constraints

- iPhone + Mac Catalyst only; portrait; dark-only Cozy Dusk theme (`Theme.*` tokens).
- `SWIFT_STRICT_CONCURRENCY: complete`, `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`: every DTO / enum used off the main actor is declared `nonisolated … Sendable`.
- Admin gating: `model.isAdmin`. Admin screens show `ContentUnavailableView("Admin only", systemImage: "lock")` for non-admins.
- Request bodies for `/estimate` and `/jobs` are encoded with the **plain** encoder: job `settings` keys stay camelCase (`convertLosslessAudio`, `targetVideoKbps`), selection keys are written snake_case via `CodingKeys` (`file_ids`, `media_id`, `season`). All responses decode with `APIClient.mediaDecoder` (snake_case → camelCase).
- Byte counts from the API are `String` in DTOs; format with `Formatters.bytesEcho`.
- Every user-facing literal needs an en + fr catalog entry in `apps/ios/Rawkoon/Localizable.xcstrings` (`python3 scripts/check-l10n.py` must pass). Add entries with `scripts/add-l10n.ts` (Task 1) — never re-serialise the catalog with a JSON round-trip (integer-like keys reorder).
- Sheets carry explicit Cancel/confirm toolbar buttons (Catalyst sheets can't be swiped away).
- Toasts: `model.toast(String(localized: "…"), style: .success | .error | .info)`.
- No server changes. Public repo: no instance-specific titles, paths, hostnames or sizes in code, tests, fixtures or commit messages.
- Swift can't be built on the Linux dev host. Every Swift verification step runs on the Mac build host:
  - **mac-sync:** `rsync -a --delete --exclude node_modules --exclude .git --exclude 'apps/ios/.build' --exclude 'apps/ios/Rawkoon.xcodeproj' ./ macbuild:~/build/rawkoon-reencode-ios/` (from the worktree root)
  - **kit-test:** `ssh macbuild 'cd ~/build/rawkoon-reencode-ios/apps/ios && swift test --filter <Suite>'`
  - **app-test:** `ssh macbuild 'cd ~/build/rawkoon-reencode-ios/apps/ios && xcodegen generate >/dev/null && xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon -destination "platform=iOS Simulator,OS=26.2,name=iPhone 17" -only-testing:RawkoonTests/<Suite> CODE_SIGNING_ALLOWED=NO 2>&1 | tail -25'` (if that simulator name is missing, list with `xcrun simctl list devices available | grep iPhone` and use one on iOS 26)
  - **app-build:** same as app-test with `xcodebuild build -destination 'generic/platform=iOS Simulator'` and no `-only-testing`
  - **lint:** `ssh macbuild 'cd ~/build/rawkoon-reencode-ios/apps/ios && swiftformat Rawkoon RawkoonTests Sources Tests --lint && swiftlint lint'`
- Commits: Conventional Commits, no Co-Authored-By trailer.

## Review Focus

1. **Request body casing** — a settings object encoded with the snake_case encoder silently becomes `convert_lossless_audio`, and the API rejects it with 400. Pinned in Task 2 (`estimateRequestKeepsCamelSettingsAndSnakeSelection`).
2. **`resolution` is a string or a number on the wire** (`"keep"`, `1080`, `720`). Decoding a job with a numeric resolution must not fail the whole jobs list. Pinned in Task 2 (`decodesNumericAndKeepResolution`).
3. **Dragging a queued job to the first slot of a batch that isn't first in the queue** must place it before that batch's first job, not at the top of the whole queue. Pinned in Task 1 (`moveToFirstSlotIsBeforeNeighbourNotTop`).
4. **Polling after the screen closes** — a poll loop that outlives the view keeps hitting the API every 2 s. Loops run inside `.task`, which SwiftUI cancels on disappear; Task 4 and Task 5 each include a manual check step that watches the server log while navigating away.
5. **Clearing CPU threads back to auto** — PATCH must send `"cpu_threads": null`, not omit the key. Pinned in Task 2 (`settingsPatchSendsNullToClearThreads`).

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/ios/scripts/add-l10n.ts` | Insert catalog entries (plain or plural) textually after `"strings": {` |
| `apps/ios/Sources/RawkoonKit/TranscodeMath.swift` | Pure helpers: target kbps, box fit, HH:MM, move placement, step index |
| `apps/ios/Tests/RawkoonKitTests/TranscodeMathTests.swift` | Tests for the above |
| `apps/ios/Rawkoon/Models+Transcode.swift` | DTOs + request bodies |
| `apps/ios/Rawkoon/APIClient+Transcode.swift` | Endpoint methods |
| `apps/ios/Rawkoon/APIClient.swift` | Add `postPlainBody<T>` helper |
| `apps/ios/RawkoonTests/TranscodeModelsTests.swift` | Encoding/decoding tests |
| `apps/ios/Rawkoon/Views/Reencode/ReencodeSheet.swift` | The settings sheet |
| `apps/ios/Rawkoon/Views/Reencode/ReencodeEstimateCard.swift` | The estimate card |
| `apps/ios/Rawkoon/Views/Reencode/ReencodeHomeCard.swift` | Home widget |
| `apps/ios/Rawkoon/Views/Settings/admin/ReencodeAdminView.swift` | Admin screen |
| Modified: `Detail/DetailFileRow.swift`, `Detail/DetailSeasonsSection.swift`, `Detail/MediaDetailView+Management.swift`, `MediaDetailView.swift`, `HomeView.swift`, `Settings/SettingsDestination.swift`, `NotificationDestination.swift`, `Notifications/NotificationDestinationView.swift`, `Notifications/NotificationLeadingVisual.swift`, `Localizable.xcstrings` | Wiring |

---

### Task 1: Catalog tool and RawkoonKit helpers

**Files:**
- Create: `apps/ios/scripts/add-l10n.ts`
- Create: `apps/ios/Sources/RawkoonKit/TranscodeMath.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/TranscodeMathTests.swift`

**Interfaces:**
- Produces:
```swift
public enum TranscodeMath {
    public static func targetKbps(gbPerFile: Double, fileCount: Int, totalAudioBytes: Double, totalDurationSecs: Double) -> Int
    public static func fitsBox(sourceWidth: Int?, sourceHeight: Int?, boxWidth: Int, boxHeight: Int) -> Bool
    public static func minutes(fromHHMM text: String) -> Int?
    public static func hhmm(fromMinutes minutes: Int) -> String
    public static func stepIndex(_ step: String?) -> Int?   // encode=0 validate=1 replace=2 rescan=3
    public static func movePlacement(ids: [Int], from source: IndexSet, to destination: Int) -> TranscodeMove?
}
public enum TranscodeMovePlacement: Equatable, Sendable { case before(Int), after(Int) }
public struct TranscodeMove: Equatable, Sendable { public let id: Int; public let placement: TranscodeMovePlacement }
```
- `bun apps/ios/scripts/add-l10n.ts <entries.json>` where the JSON is `{ "<key>": "<fr>" }` for plain strings or `{ "<key>": { "en": { "one": "…", "other": "…" }, "fr": { "one": "…", "other": "…" } } }` for plurals. Existing keys are skipped.

- [ ] **Step 1: Write the catalog tool**

`apps/ios/scripts/add-l10n.ts`:
```ts
// Adds entries to Localizable.xcstrings without re-serialising the file
// (a JSON round-trip reorders integer-like keys such as "0").
// usage: bun scripts/add-l10n.ts entries.json
type Plural = { one: string; other: string };
type Entry = string | { en: Plural; fr: Plural };

const catalogPath = new URL("../Rawkoon/Localizable.xcstrings", import.meta.url).pathname;
const entries = JSON.parse(await Bun.file(process.argv[2]).text()) as Record<string, Entry>;
const text = await Bun.file(catalogPath).text();
const existing = new Set(Object.keys(JSON.parse(text).strings));

const unit = (value: string) => ({ stringUnit: { state: "translated", value } });
const plural = (p: Plural) => ({ variations: { plural: { one: unit(p.one), other: unit(p.other) } } });

const blocks: string[] = [];
for (const [key, entry] of Object.entries(entries)) {
  if (existing.has(key)) continue;
  const localizations =
    typeof entry === "string" ? { fr: unit(entry) } : { en: plural(entry.en), fr: plural(entry.fr) };
  const body = JSON.stringify({ localizations }, null, 2).split("\n").join("\n    ");
  blocks.push(`    ${JSON.stringify(key)}: ${body}`);
}
if (!blocks.length) {
  console.log("nothing to add");
  process.exit(0);
}
const anchor = '  "strings": {\n';
const at = text.indexOf(anchor);
if (at < 0) throw new Error("catalog anchor not found");
const insertAt = at + anchor.length;
const out = `${text.slice(0, insertAt)}${blocks.join(",\n")},\n${text.slice(insertAt)}`;
JSON.parse(out); // refuse to write an invalid catalog
await Bun.write(catalogPath, out);
console.log(`added ${blocks.length} entr${blocks.length === 1 ? "y" : "ies"}`);
```

- [ ] **Step 2: Check the tool on a throwaway copy**

Run:
```bash
cd apps/ios && cp Rawkoon/Localizable.xcstrings /tmp/xc.bak \
&& echo '{"Probe key": "Clé test", "%lld probes": {"en":{"one":"%lld probe","other":"%lld probes"},"fr":{"one":"%lld essai","other":"%lld essais"}}}' > /tmp/probe.json \
&& bun scripts/add-l10n.ts /tmp/probe.json && git diff --stat Rawkoon/Localizable.xcstrings \
&& cp /tmp/xc.bak Rawkoon/Localizable.xcstrings && git diff --quiet Rawkoon/Localizable.xcstrings && echo restored
```
Expected: `added 2 entries`, a diff of about 40 inserted lines and no deletions, then `restored`.

- [ ] **Step 3: Write the failing kit tests**

`apps/ios/Tests/RawkoonKitTests/TranscodeMathTests.swift`:
```swift
import Foundation
@testable import RawkoonKit
import Testing

struct TranscodeMathTests {
    @Test func targetKbpsSubtractsAudioAndSpreadsOverDuration() {
        // 2 files × 1.5 GB, 100 MB audio, 2 h total → (3e9 − 1e8) × 8 / 7200 / 1000
        #expect(TranscodeMath.targetKbps(gbPerFile: 1.5, fileCount: 2, totalAudioBytes: 100_000_000, totalDurationSecs: 7200) == 3222)
    }

    @Test func targetKbpsFloorsAt100() {
        #expect(TranscodeMath.targetKbps(gbPerFile: 0.01, fileCount: 1, totalAudioBytes: 100_000_000, totalDurationSecs: 3600) == 100)
        #expect(TranscodeMath.targetKbps(gbPerFile: 2, fileCount: 1, totalAudioBytes: 0, totalDurationSecs: 0) == 100)
    }

    @Test func fitsBoxChecksBothSides() {
        #expect(TranscodeMath.fitsBox(sourceWidth: 1920, sourceHeight: 1080, boxWidth: 1920, boxHeight: 1080))
        #expect(!TranscodeMath.fitsBox(sourceWidth: 2560, sourceHeight: 1072, boxWidth: 1920, boxHeight: 1080))
        #expect(!TranscodeMath.fitsBox(sourceWidth: 3840, sourceHeight: 2160, boxWidth: 1920, boxHeight: 1080))
        #expect(TranscodeMath.fitsBox(sourceWidth: nil, sourceHeight: 720, boxWidth: 1280, boxHeight: 720))
        #expect(!TranscodeMath.fitsBox(sourceWidth: nil, sourceHeight: nil, boxWidth: 1280, boxHeight: 720))
    }

    @Test func hhmmRoundTrips() {
        #expect(TranscodeMath.minutes(fromHHMM: "01:30") == 90)
        #expect(TranscodeMath.minutes(fromHHMM: "23:59") == 1439)
        #expect(TranscodeMath.minutes(fromHHMM: "24:00") == nil)
        #expect(TranscodeMath.minutes(fromHHMM: "7:5") == nil)
        #expect(TranscodeMath.hhmm(fromMinutes: 90) == "01:30")
        #expect(TranscodeMath.hhmm(fromMinutes: 0) == "00:00")
        #expect(TranscodeMath.hhmm(fromMinutes: 1500) == "01:00")
    }

    @Test func stepIndexOrdersPipelineSteps() {
        #expect(TranscodeMath.stepIndex("encode") == 0)
        #expect(TranscodeMath.stepIndex("rescan") == 3)
        #expect(TranscodeMath.stepIndex("preflight") == nil)
        #expect(TranscodeMath.stepIndex(nil) == nil)
    }

    @Test func moveDownPlacesAfterNewPredecessor() throws {
        // [1,2,3,4]: drag 1 to between 3 and 4 → SwiftUI destination 3
        let r = try #require(TranscodeMath.movePlacement(ids: [1, 2, 3, 4], from: IndexSet(integer: 0), to: 3))
        #expect(r.id == 1)
        #expect(r.placement == .after(3))
    }

    @Test func moveUpPlacesAfterNewPredecessor() throws {
        let r = try #require(TranscodeMath.movePlacement(ids: [1, 2, 3, 4], from: IndexSet(integer: 3), to: 1))
        #expect(r.id == 4)
        #expect(r.placement == .after(1))
    }

    @Test func moveToFirstSlotIsBeforeNeighbourNotTop() throws {
        let r = try #require(TranscodeMath.movePlacement(ids: [5, 6, 7], from: IndexSet(integer: 2), to: 0))
        #expect(r.id == 7)
        #expect(r.placement == .before(5))
    }

    @Test func noOpAndInvalidMovesReturnNil() {
        #expect(TranscodeMath.movePlacement(ids: [1, 2, 3], from: IndexSet(integer: 1), to: 1) == nil)
        #expect(TranscodeMath.movePlacement(ids: [1, 2, 3], from: IndexSet(integer: 1), to: 2) == nil)
        #expect(TranscodeMath.movePlacement(ids: [1], from: IndexSet(integer: 0), to: 1) == nil)
        #expect(TranscodeMath.movePlacement(ids: [1, 2, 3], from: IndexSet([0, 1]), to: 3) == nil)
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: mac-sync, then kit-test with `--filter TranscodeMathTests`.
Expected: build error `cannot find 'TranscodeMath' in scope`.

- [ ] **Step 5: Implement**

`apps/ios/Sources/RawkoonKit/TranscodeMath.swift`:
```swift
import Foundation

public enum TranscodeMovePlacement: Equatable, Sendable {
    case before(Int)
    case after(Int)
}

public struct TranscodeMove: Equatable, Sendable {
    public let id: Int
    public let placement: TranscodeMovePlacement
}

/// Pure helpers for the re-encode screens (mirrors the web client's math).
public enum TranscodeMath {
    /// Video bitrate that makes a batch average `gbPerFile` once audio is counted.
    public static func targetKbps(gbPerFile: Double, fileCount: Int, totalAudioBytes: Double, totalDurationSecs: Double) -> Int {
        guard totalDurationSecs > 0 else { return 100 }
        let videoBits = (gbPerFile * 1e9 * Double(fileCount) - totalAudioBytes) * 8
        return max(100, Int((videoBits / totalDurationSecs / 1000).rounded()))
    }

    /// True when the source already fits the box, so downscaling to it would do nothing.
    public static func fitsBox(sourceWidth: Int?, sourceHeight: Int?, boxWidth: Int, boxHeight: Int) -> Bool {
        guard let sourceHeight else { return false }
        return sourceHeight <= boxHeight && (sourceWidth ?? 0) <= boxWidth
    }

    public static func minutes(fromHHMM text: String) -> Int? {
        let parts = text.split(separator: ":")
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]), (0 ..< 24).contains(h), (0 ..< 60).contains(m)
        else { return nil }
        return h * 60 + m
    }

    public static func hhmm(fromMinutes minutes: Int) -> String {
        let wrapped = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", wrapped / 60, wrapped % 60)
    }

    public static func stepIndex(_ step: String?) -> Int? {
        switch step {
        case "encode": 0
        case "validate": 1
        case "replace": 2
        case "rescan": 3
        default: nil
        }
    }

    /// Turns one SwiftUI `.onMove` into a single API move relative to the new neighbour.
    public static func movePlacement(ids: [Int], from source: IndexSet, to destination: Int) -> TranscodeMove? {
        guard ids.count > 1, source.count == 1, let from = source.first, ids.indices.contains(from) else { return nil }
        var order = ids
        let moved = order.remove(at: from)
        let insertAt = destination > from ? destination - 1 : destination
        guard insertAt != from else { return nil }
        order.insert(moved, at: min(max(insertAt, 0), order.count))
        guard let newIndex = order.firstIndex(of: moved) else { return nil }
        return newIndex == 0
            ? TranscodeMove(id: moved, placement: .before(order[1]))
            : TranscodeMove(id: moved, placement: .after(order[newIndex - 1]))
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: mac-sync, then kit-test with `--filter TranscodeMathTests`.
Expected: `Test run with 9 tests passed`.

- [ ] **Step 7: Commit**

```bash
git add apps/ios/scripts/add-l10n.ts apps/ios/Sources/RawkoonKit/TranscodeMath.swift apps/ios/Tests/RawkoonKitTests/TranscodeMathTests.swift
git commit -m "feat(ios): add re-encode math helpers and a catalog entry tool"
```

---

### Task 2: Models and API client

**Files:**
- Create: `apps/ios/Rawkoon/Models+Transcode.swift`
- Create: `apps/ios/Rawkoon/APIClient+Transcode.swift`
- Modify: `apps/ios/Rawkoon/APIClient.swift` (add `postPlainBody` next to `postPlainExpectOK`)
- Test: `apps/ios/RawkoonTests/TranscodeModelsTests.swift`

**Interfaces:**
- Produces (all `nonisolated`, `Sendable`):
```swift
enum TranscodeCodec: String, Codable, Hashable, CaseIterable { case hevc, av1 }
enum TranscodeEncoder: String, Codable, Hashable, CaseIterable { case software, vaapi }
enum TranscodeResolution: Codable, Hashable { case keep, p1080, p720 }   // wire: "keep" | 1080 | 720
enum TranscodeMode: String, Codable, Hashable { case quality, target }
enum TranscodePreset: String, Codable, Hashable, CaseIterable { case high, balanced, small }
enum TranscodeSpeed: String, Codable, Hashable, CaseIterable { case slower, `default`, faster }
struct TranscodeJobSettings: Codable, Hashable { codec, encoder, resolution, mode, preset, quality: Int?, speed, targetVideoKbps: Int?, convertLosslessAudio }
struct TranscodeSelection: Encodable, Hashable { fileIds: [Int]?, mediaId: Int?, season: Int? }
struct TranscodeCapabilities, TranscodeCombo, TranscodeEstimate, TranscodeEstimateFile, TranscodeExcludedFile, TranscodeAudioChange,
       TranscodeLiveProgress, TranscodeJob, TranscodeJobsResponse, TranscodeQueueSettings, TranscodeSettingsPatch,
       TranscodeSummary, TranscodeEnqueueResponse
// APIClient
func transcodeCapabilities() async throws -> TranscodeCapabilities
func transcodeEstimate(selection: TranscodeSelection, settings: TranscodeJobSettings, refine: Bool) async throws -> TranscodeEstimate
func enqueueTranscode(selection: TranscodeSelection, settings: TranscodeJobSettings) async throws -> TranscodeEnqueueResponse
func transcodeJobs(active: Bool) async throws -> [TranscodeJob]
func cancelTranscodeJob(id: Int) async throws
func moveTranscodeJob(id: Int, placement: TranscodeMovePlacement?) async throws   // nil = to top
func retryTranscodeJob(id: Int) async throws
func removeTranscodeBatch(id: String) async throws
func moveTranscodeBatchToTop(id: String) async throws
func clearTranscodeHistory() async throws
func transcodeSettings() async throws -> TranscodeQueueSettings
func updateTranscodeSettings(_ patch: TranscodeSettingsPatch) async throws -> TranscodeQueueSettings
func transcodeSummary() async throws -> TranscodeSummary
```

- [ ] **Step 1: Write the failing tests**

`apps/ios/RawkoonTests/TranscodeModelsTests.swift`:
```swift
import Foundation
@testable import Rawkoon
import Testing

struct TranscodeModelsTests {
    private func snakeDecoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    private func plainSorted(_ value: some Encodable) throws -> String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return String(decoding: try e.encode(value), as: UTF8.self)
    }

    @Test func estimateRequestKeepsCamelSettingsAndSnakeSelection() throws {
        var s = TranscodeJobSettings()
        s.convertLosslessAudio = true
        s.resolution = .p1080
        let body = TranscodeEstimateRequest(
            selection: TranscodeSelection(fileIds: nil, mediaId: 7, season: 2), settings: s, refine: false
        )
        let json = try plainSorted(body)
        #expect(json.contains(#""selection":{"media_id":7,"season":2}"#))
        #expect(json.contains(#""convertLosslessAudio":true"#))
        #expect(json.contains(#""resolution":1080"#))
        #expect(!json.contains("convert_lossless_audio"))
        #expect(!json.contains("file_ids"))
    }

    @Test func keepResolutionEncodesAsString() throws {
        #expect(try plainSorted(TranscodeJobSettings()).contains(#""resolution":"keep""#))
    }

    @Test func decodesNumericAndKeepResolution() throws {
        let json = #"""
        {"jobs":[
          {"id":1,"media_file_id":3,"media_id":2,"batch_id":"b","title":"A","position":1,"status":"queued","step":null,
           "settings":{"codec":"av1","encoder":"software","resolution":720,"mode":"quality","preset":"small","speed":"default","convertLosslessAudio":false},
           "source_bytes":"10","estimated_bytes":"4","output_bytes":null,"source_nlink":null,"progress":null,"ssim_avg":null,"ssim_min":null,
           "error":null,"created_at":"x","started_at":null,"finished_at":null,"poster_url":null,"live":null},
          {"id":2,"media_file_id":null,"media_id":null,"batch_id":"b","title":"B","position":2,"status":"running","step":"encode",
           "settings":{"codec":"hevc","encoder":"vaapi","resolution":"keep","mode":"target","preset":"balanced","speed":"default","targetVideoKbps":3000,"convertLosslessAudio":true},
           "source_bytes":"10","estimated_bytes":null,"output_bytes":null,"source_nlink":2,"progress":0.5,"ssim_avg":null,"ssim_min":null,
           "error":null,"created_at":"x","started_at":"y","finished_at":null,"poster_url":"/p.jpg",
           "live":{"progress":0.5,"fps":210.5,"speed":8.8,"eta_secs":60,"current_bytes":"5"}}
        ]}
        """#
        let r = try snakeDecoder().decode(TranscodeJobsResponse.self, from: Data(json.utf8))
        #expect(r.jobs[0].settings.resolution == .p720)
        #expect(r.jobs[1].settings.resolution == .keep)
        #expect(r.jobs[1].settings.targetVideoKbps == 3000)
        #expect(r.jobs[1].live?.etaSecs == 60)
    }

    @Test func decodesSummaryWith30dKeys() throws {
        let json = #"""
        {"show":true,"state":"waiting_window","window_start":"01:00","current":null,"next":[],"queued_count":3,
         "queued_source_bytes":"30","queued_eta_secs":100,"saved_bytes_30d":"187","done_count_30d":34,
         "frees_after_seeding_bytes":"9","failed_count":1}
        """#
        let s = try snakeDecoder().decode(TranscodeSummary.self, from: Data(json.utf8))
        #expect(s.state == "waiting_window")
        #expect(s.savedBytes30d == "187")
        #expect(s.doneCount30d == 34)
    }

    @Test func decodesEstimateWithOptionalWidth() throws {
        let json = #"""
        {"files":[{"file_id":1,"title":"A","source_bytes":"10","estimated_bytes":"4","nlink":2,"duration_secs":100.5}],
         "excluded":[{"file_id":2,"title":"B","reason":"Already queued"}],
         "total_source_bytes":"10","total_estimated_bytes":"4","total_duration_secs":100,"total_audio_bytes":"1",
         "range_pct":15,"frees_now_bytes":"0","frees_after_seeding_bytes":"6","temporary_growth_bytes":"4","eta_secs":60,
         "source":"rough","refined_files":0,"refined_clips":0,"audio_changes":[{"label":"ENG · TRUEHD 8ch","to":"EAC3 768k"}],
         "source_height":1080}
        """#
        let e = try snakeDecoder().decode(TranscodeEstimate.self, from: Data(json.utf8))
        #expect(e.sourceWidth == nil)
        #expect(e.files.first?.nlink == 2)
        #expect(e.audioChanges.first?.to == "EAC3 768k")
    }

    @Test func settingsPatchSendsNullToClearThreads() throws {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.outputFormatting = [.sortedKeys]
        let cleared = String(decoding: try e.encode(TranscodeSettingsPatch(cpuThreads: .some(nil))), as: UTF8.self)
        #expect(cleared == #"{"cpu_threads":null}"#)
        let paused = String(decoding: try e.encode(TranscodeSettingsPatch(paused: true)), as: UTF8.self)
        #expect(paused == #"{"paused":true}"#)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: mac-sync, then app-test with suite `TranscodeModelsTests`.
Expected: build failure `cannot find 'TranscodeJobSettings' in scope`.

- [ ] **Step 3: Implement the models**

`apps/ios/Rawkoon/Models+Transcode.swift`:
```swift
import Foundation

nonisolated enum TranscodeCodec: String, Codable, Hashable, CaseIterable, Sendable { case hevc, av1 }
nonisolated enum TranscodeEncoder: String, Codable, Hashable, CaseIterable, Sendable { case software, vaapi }
nonisolated enum TranscodeMode: String, Codable, Hashable, Sendable { case quality, target }
nonisolated enum TranscodePreset: String, Codable, Hashable, CaseIterable, Sendable { case high, balanced, small }
nonisolated enum TranscodeSpeed: String, Codable, Hashable, CaseIterable, Sendable { case slower, `default`, faster }

/// The API sends `"keep"` or a height number.
nonisolated enum TranscodeResolution: Codable, Hashable, Sendable {
    case keep, p1080, p720

    var box: (width: Int, height: Int)? {
        switch self {
        case .keep: nil
        case .p1080: (1920, 1080)
        case .p720: (1280, 720)
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let height = try? c.decode(Int.self) {
            self = height <= 720 ? .p720 : .p1080
        } else {
            self = .keep
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .keep: try c.encode("keep")
        case .p1080: try c.encode(1080)
        case .p720: try c.encode(720)
        }
    }
}

/// Wire keys are camelCase (the API validates them verbatim) — encode with the plain encoder.
nonisolated struct TranscodeJobSettings: Codable, Hashable, Sendable {
    var codec: TranscodeCodec = .hevc
    var encoder: TranscodeEncoder = .software
    var resolution: TranscodeResolution = .keep
    var mode: TranscodeMode = .quality
    var preset: TranscodePreset = .balanced
    var quality: Int?
    var speed: TranscodeSpeed = .default
    var targetVideoKbps: Int?
    var convertLosslessAudio = false
}

nonisolated struct TranscodeSelection: Encodable, Hashable, Sendable {
    var fileIds: [Int]?
    var mediaId: Int?
    var season: Int?

    enum CodingKeys: String, CodingKey {
        case fileIds = "file_ids"
        case mediaId = "media_id"
        case season
    }
}

nonisolated struct TranscodeEstimateRequest: Encodable, Sendable {
    let selection: TranscodeSelection
    let settings: TranscodeJobSettings
    let refine: Bool
}

nonisolated struct TranscodeEnqueueRequest: Encodable, Sendable {
    let selection: TranscodeSelection
    let settings: TranscodeJobSettings
}

nonisolated struct TranscodeCombo: Decodable, Hashable, Sendable {
    let codec: TranscodeCodec
    let encoder: TranscodeEncoder
}

nonisolated struct TranscodeCapabilities: Decodable, Sendable {
    let combos: [TranscodeCombo]
    let deviceLabel: String?
    let vaapiUnavailableReason: String?

    func supports(_ codec: TranscodeCodec, _ encoder: TranscodeEncoder) -> Bool {
        combos.contains(TranscodeCombo(codec: codec, encoder: encoder))
    }
}

nonisolated struct TranscodeEstimateFile: Decodable, Identifiable, Sendable {
    let fileId: Int
    let title: String
    let sourceBytes: String
    let estimatedBytes: String
    let nlink: Int
    let durationSecs: Double
    var id: Int { fileId }
}

nonisolated struct TranscodeExcludedFile: Decodable, Identifiable, Sendable {
    let fileId: Int
    let title: String
    let reason: String
    var id: Int { fileId }
}

nonisolated struct TranscodeAudioChange: Decodable, Identifiable, Sendable {
    let label: String
    let to: String
    var id: String { label }
}

nonisolated struct TranscodeEstimate: Decodable, Sendable {
    let files: [TranscodeEstimateFile]
    let excluded: [TranscodeExcludedFile]
    let totalSourceBytes: String
    let totalEstimatedBytes: String
    let totalDurationSecs: Double
    let totalAudioBytes: String
    let rangePct: Int
    let freesNowBytes: String
    let freesAfterSeedingBytes: String
    let temporaryGrowthBytes: String
    let etaSecs: Int
    let source: String
    let refinedFiles: Int
    let refinedClips: Int
    let audioChanges: [TranscodeAudioChange]
    let sourceHeight: Int?
    let sourceWidth: Int?
}

nonisolated struct TranscodeEnqueueResponse: Decodable, Sendable {
    let batchId: String
    let count: Int
}

nonisolated struct TranscodeLiveProgress: Decodable, Sendable {
    let progress: Double
    let fps: Double?
    let speed: Double?
    let etaSecs: Int?
    let currentBytes: String?
}

nonisolated struct TranscodeJob: Decodable, Identifiable, Sendable {
    let id: Int
    let mediaFileId: Int?
    let mediaId: Int?
    let batchId: String
    let title: String
    let position: Double
    let status: String
    let step: String?
    let settings: TranscodeJobSettings
    let sourceBytes: String
    let estimatedBytes: String?
    let outputBytes: String?
    let sourceNlink: Int?
    let progress: Double?
    let ssimAvg: Double?
    let ssimMin: Double?
    let error: String?
    let createdAt: String
    let startedAt: String?
    let finishedAt: String?
    let posterUrl: String?
    let live: TranscodeLiveProgress?
}

nonisolated struct TranscodeJobsResponse: Decodable, Sendable {
    let jobs: [TranscodeJob]
}

nonisolated struct TranscodeQueueSettings: Decodable, Sendable, Equatable {
    let paused: Bool
    let windowEnabled: Bool
    let windowStart: String
    let windowEnd: String
    let ssimThreshold: Double
    let ssimClipMin: Double
    let cpuThreads: Int?
}

/// PATCH body: only set fields are sent; `cpuThreads: .some(nil)` sends null (back to auto).
nonisolated struct TranscodeSettingsPatch: Encodable, Sendable {
    var paused: Bool?
    var windowEnabled: Bool?
    var windowStart: String?
    var windowEnd: String?
    var ssimThreshold: Double?
    var ssimClipMin: Double?
    var cpuThreads: Int??

    enum CodingKeys: String, CodingKey {
        case paused, windowEnabled, windowStart, windowEnd, ssimThreshold, ssimClipMin, cpuThreads
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(paused, forKey: .paused)
        try c.encodeIfPresent(windowEnabled, forKey: .windowEnabled)
        try c.encodeIfPresent(windowStart, forKey: .windowStart)
        try c.encodeIfPresent(windowEnd, forKey: .windowEnd)
        try c.encodeIfPresent(ssimThreshold, forKey: .ssimThreshold)
        try c.encodeIfPresent(ssimClipMin, forKey: .ssimClipMin)
        if let threads = cpuThreads {
            if let value = threads {
                try c.encode(value, forKey: .cpuThreads)
            } else {
                try c.encodeNil(forKey: .cpuThreads)
            }
        }
    }
}

nonisolated struct TranscodeSummary: Decodable, Sendable {
    let show: Bool
    let state: String
    let windowStart: String
    let current: TranscodeJob?
    let next: [TranscodeJob]
    let queuedCount: Int
    let queuedSourceBytes: String
    let queuedEtaSecs: Int
    let savedBytes30d: String
    let doneCount30d: Int
    let freesAfterSeedingBytes: String
    let failedCount: Int
}
```

- [ ] **Step 4: Add the plain-body helper**

In `apps/ios/Rawkoon/APIClient.swift`, directly after `postPlainExpectOK`, add:
```swift
    /// POST whose body keeps its own key names (the re-encode settings are camelCase on the wire)
    /// while the response still decodes snake_case.
    func postPlainBody<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        var request = try makeRequest(path: path, method: "POST", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.plainEncoder.encode(body)
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
        return try decodeJSON(data)
    }
```

- [ ] **Step 5: Implement the endpoints**

`apps/ios/Rawkoon/APIClient+Transcode.swift`:
```swift
import Foundation
import RawkoonKit

extension APIClient {
    func transcodeCapabilities() async throws -> TranscodeCapabilities {
        try await get("/api/transcode/capabilities")
    }

    func transcodeEstimate(selection: TranscodeSelection, settings: TranscodeJobSettings, refine: Bool) async throws -> TranscodeEstimate {
        try await postPlainBody(
            "/api/transcode/estimate",
            body: TranscodeEstimateRequest(selection: selection, settings: settings, refine: refine)
        )
    }

    func enqueueTranscode(selection: TranscodeSelection, settings: TranscodeJobSettings) async throws -> TranscodeEnqueueResponse {
        try await postPlainBody("/api/transcode/jobs", body: TranscodeEnqueueRequest(selection: selection, settings: settings))
    }

    func transcodeJobs(active: Bool) async throws -> [TranscodeJob] {
        let since = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-30 * 86400))
        let query: [String: String?] = active
            ? ["status": "queued,running"]
            : ["status": "done,failed,cancelled", "since": since]
        let response: TranscodeJobsResponse = try await get("/api/transcode/jobs", query: query)
        return response.jobs
    }

    func cancelTranscodeJob(id: Int) async throws {
        try await deleteExpectOK("/api/transcode/jobs/\(id)")
    }

    /// `nil` placement moves the job to the top of the queue.
    func moveTranscodeJob(id: Int, placement: TranscodeMovePlacement?) async throws {
        nonisolated struct Body: Encodable { var top: Bool?; var beforeId: Int?; var afterId: Int? }
        let body: Body = switch placement {
        case nil: Body(top: true)
        case let .before(other): Body(beforeId: other)
        case let .after(other): Body(afterId: other)
        }
        try await postExpectOK("/api/transcode/jobs/\(id)/move", body: body)
    }

    func retryTranscodeJob(id: Int) async throws {
        nonisolated struct Empty: Encodable {}
        try await postExpectOK("/api/transcode/jobs/\(id)/retry", body: Empty())
    }

    func removeTranscodeBatch(id: String) async throws {
        try await deleteExpectOK("/api/transcode/batches/\(id)")
    }

    func moveTranscodeBatchToTop(id: String) async throws {
        nonisolated struct Body: Encodable { let top = true }
        try await postExpectOK("/api/transcode/batches/\(id)/move", body: Body())
    }

    func clearTranscodeHistory() async throws {
        try await deleteExpectOK("/api/transcode/history")
    }

    func transcodeSettings() async throws -> TranscodeQueueSettings {
        try await get("/api/transcode/settings")
    }

    func updateTranscodeSettings(_ patch: TranscodeSettingsPatch) async throws -> TranscodeQueueSettings {
        try await patch("/api/transcode/settings", body: patch)
    }

    func transcodeSummary() async throws -> TranscodeSummary {
        try await get("/api/transcode/summary")
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: mac-sync, then app-test with suite `TranscodeModelsTests`.
Expected: `Test Suite 'TranscodeModelsTests' passed` — 6 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/ios/Rawkoon/Models+Transcode.swift apps/ios/Rawkoon/APIClient+Transcode.swift apps/ios/Rawkoon/APIClient.swift apps/ios/RawkoonTests/TranscodeModelsTests.swift
git commit -m "feat(ios): add re-encode API client and models"
```

---

### Task 3: Re-encode sheet and detail entry points

**Files:**
- Create: `apps/ios/Rawkoon/Views/Reencode/ReencodeSheet.swift`
- Create: `apps/ios/Rawkoon/Views/Reencode/ReencodeEstimateCard.swift`
- Modify: `apps/ios/Rawkoon/Views/Detail/DetailFileRow.swift`
- Modify: `apps/ios/Rawkoon/Views/Detail/DetailSeasonsSection.swift`
- Modify: `apps/ios/Rawkoon/Views/Detail/MediaDetailView+Management.swift`
- Modify: `apps/ios/Rawkoon/Views/MediaDetailView.swift`
- Modify: `apps/ios/Rawkoon/Localizable.xcstrings` (via `add-l10n.ts`)

**Interfaces:**
- Consumes: Task 1 `TranscodeMath`, Task 2 models + API.
- Produces:
```swift
struct ReencodeTarget: Identifiable { let id: UUID; let selection: TranscodeSelection; let subtitle: String }
struct ReencodeSheet: View { init(target: ReencodeTarget, onQueued: @escaping (Int) -> Void) }
struct ReencodeEstimateCard: View { init(estimate: TranscodeEstimate?, mode: TranscodeMode, outdated: Bool, refining: Bool, canRefine: Bool, onRefine: @escaping () -> Void) }
// DetailFileRow gains: let onReencode: (() -> Void)?   (nil hides the action)
// DetailSeasonsSection gains: let onSeasonReencode: (Int) -> Void
// MediaDetailView gains: @State var reencodeTarget: ReencodeTarget?
```

- [ ] **Step 1: Write the estimate card**

`apps/ios/Rawkoon/Views/Reencode/ReencodeEstimateCard.swift`:
```swift
import RawkoonKit
import SwiftUI

/// Always-visible summary at the bottom of the re-encode sheet.
struct ReencodeEstimateCard: View {
    let estimate: TranscodeEstimate?
    let mode: TranscodeMode
    let outdated: Bool
    let refining: Bool
    let canRefine: Bool
    let onRefine: () -> Void

    var body: some View {
        if let estimate {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(verbatim: (mode == .target ? "" : "≈ ") + Formatters.bytesEcho(estimate.totalEstimatedBytes))
                        .font(.display(26)).foregroundStyle(Theme.textStrong)
                    Text(verbatim: Formatters.bytesEcho(estimate.totalSourceBytes))
                        .strikethrough().font(.subheadline).foregroundStyle(Theme.faint)
                    Text(verbatim: "±\(estimate.rangePct)%").font(.caption).foregroundStyle(Theme.muted)
                    Spacer()
                    if let saved = savedBytes(estimate), saved > 0 {
                        Text("−\(Formatters.bytesEcho(String(saved))) saved")
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.seed).chipCapsule(tint: Theme.seed)
                    }
                }
                freesBar(estimate)
                HStack(alignment: .top) {
                    figure("Frees now", Formatters.bytesEcho(estimate.freesNowBytes), strong: true)
                    figure("After seeding", "+" + Formatters.bytesEcho(estimate.freesAfterSeedingBytes), strong: false)
                    figure("Est. time", "~" + (Formatters.durationCompact(Double(estimate.etaSecs)) ?? "0m"), strong: true)
                }
                let seeding = estimate.files.filter { $0.nlink > 1 }.count
                if seeding > 0 {
                    Text("\(seeding) files are still seeding. Their space frees when the torrents are removed; until then disk use grows by about \(Formatters.bytesEcho(estimate.temporaryGrowthBytes)).")
                        .font(.caption).foregroundStyle(Theme.apricotSoft)
                        .padding(10)
                        .background(Theme.apricot.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                HStack {
                    sourceLine(estimate)
                    Spacer()
                    if mode == .quality, canRefine {
                        Button(estimate.source == "refined" && !outdated ? "Refine again" : "Refine estimate", action: onRefine)
                            .font(.caption.weight(.semibold)).tint(Theme.apricot).disabled(refining)
                    }
                }
            }
            .listRowBackground(Theme.well)
        } else {
            HStack {
                ProgressView().tint(Theme.muted)
                Text("Estimating…").foregroundStyle(Theme.muted)
            }
            .listRowBackground(Theme.well)
        }
    }

    private func savedBytes(_ e: TranscodeEstimate) -> Int64? {
        guard let src = Int64(e.totalSourceBytes), let est = Int64(e.totalEstimatedBytes) else { return nil }
        return src - est
    }

    private func freesBar(_ e: TranscodeEstimate) -> some View {
        let total = max(Double(e.totalSourceBytes) ?? 1, 1)
        let now = (Double(e.freesNowBytes) ?? 0) / total
        let later = (Double(e.freesAfterSeedingBytes) ?? 0) / total
        return GeometryReader { geo in
            HStack(spacing: 0) {
                Rectangle().fill(Theme.seed).frame(width: geo.size.width * now)
                Rectangle().fill(Theme.seed.opacity(0.35)).frame(width: geo.size.width * later)
                Spacer(minLength: 0)
            }
            .background(Theme.border)
            .clipShape(Capsule())
        }
        .frame(height: 6)
    }

    private func figure(_ title: LocalizedStringKey, _ value: String, strong: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(.caption2, design: .monospaced)).foregroundStyle(Theme.faint)
            Text(verbatim: value).font(.subheadline.weight(strong ? .medium : .regular))
                .foregroundStyle(strong ? Theme.textStrong : Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func sourceLine(_ e: TranscodeEstimate) -> some View {
        Group {
            if refining {
                Text("Sampling clips…")
            } else if e.source == "target" {
                Text("Computed from bitrate × duration")
            } else if outdated {
                Text("Estimate outdated — settings changed").foregroundStyle(Theme.apricotSoft)
            } else if e.source == "refined" {
                Text("Refined · \(e.refinedFiles) files · \(e.refinedClips) clips")
            } else {
                Text("Rough estimate · bitrate model")
            }
        }
        .font(.caption).foregroundStyle(Theme.muted)
    }
}
```

- [ ] **Step 2: Write the sheet**

`apps/ios/Rawkoon/Views/Reencode/ReencodeSheet.swift`:
```swift
import RawkoonKit
import SwiftUI

struct ReencodeTarget: Identifiable {
    let id = UUID()
    let selection: TranscodeSelection
    let subtitle: String
}

/// Native counterpart of the web re-encode modal.
struct ReencodeSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let target: ReencodeTarget
    let onQueued: (Int) -> Void

    @State private var settings = TranscodeJobSettings()
    @State private var gbPerFile = 1.5
    @State private var qualityText = ""
    @State private var caps: TranscodeCapabilities?
    /// Quality-mode estimate for the current video/audio choices; also feeds the target-mode bitrate.
    @State private var base: TranscodeEstimate?
    @State private var targetEstimate: TranscodeEstimate?
    @State private var refined: (settings: TranscodeJobSettings, estimate: TranscodeEstimate)?
    @State private var refining = false
    @State private var submitting = false

    private var qualitySettings: TranscodeJobSettings {
        var s = settings
        s.mode = .quality
        s.targetVideoKbps = nil
        return s
    }

    private var effectiveSettings: TranscodeJobSettings {
        guard settings.mode == .target, let base else { return qualitySettings }
        var s = settings
        s.targetVideoKbps = TranscodeMath.targetKbps(
            gbPerFile: gbPerFile,
            fileCount: base.files.count,
            totalAudioBytes: Double(base.totalAudioBytes) ?? 0,
            totalDurationSecs: base.totalDurationSecs
        )
        return s
    }

    private var shownEstimate: TranscodeEstimate? {
        if settings.mode == .target { return targetEstimate }
        if let refined, refined.settings == effectiveSettings { return refined.estimate }
        return base
    }

    private var outdated: Bool {
        settings.mode == .quality && refined != nil && refined?.settings != effectiveSettings
    }

    private var eligibleCount: Int {
        shownEstimate?.files.count ?? base?.files.count ?? 0
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(verbatim: target.subtitle).foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
                videoSection
                sizeSection
                audioSection
                if let excluded = shownEstimate?.excluded, !excluded.isEmpty {
                    Section {
                        DisclosureGroup("\(excluded.count) files skipped") {
                            ForEach(excluded) { x in
                                Text(verbatim: "\(x.title) — \(x.reason)").font(.caption).foregroundStyle(Theme.muted)
                            }
                        }
                        .listRowBackground(Theme.raised)
                    }
                }
                Section {
                    ReencodeEstimateCard(
                        estimate: shownEstimate,
                        mode: settings.mode,
                        outdated: outdated,
                        refining: refining,
                        canRefine: eligibleCount > 0,
                        onRefine: { Task { await refine() } }
                    )
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .tint(Theme.apricot)
            .navigationTitle("Re-encode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add \(eligibleCount) files") { Task { await submit() } }
                        .disabled(eligibleCount == 0 || submitting)
                }
            }
            .task { await loadCapabilities() }
            .task(id: qualitySettings) {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                base = await fetch(qualitySettings, refine: false) ?? base
            }
            .task(id: settings.mode == .target ? effectiveSettings : nil) {
                guard settings.mode == .target, base != nil else { return }
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                targetEstimate = await fetch(effectiveSettings, refine: false) ?? targetEstimate
            }
        }
    }

    // MARK: Sections

    private var videoSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("Codec").font(.footnote).foregroundStyle(Theme.muted)
                Picker("Codec", selection: $settings.codec) {
                    Text(verbatim: "HEVC").tag(TranscodeCodec.hevc)
                    Text(verbatim: "AV1").tag(TranscodeCodec.av1)
                }
                .pickerStyle(.segmented)
                Text(settings.codec == .hevc ? "Widest support" : "Smallest files")
                    .font(.caption2).foregroundStyle(Theme.faint)
            }
            .listRowBackground(Theme.raised)
            VStack(alignment: .leading, spacing: 6) {
                Text("Encoder").font(.footnote).foregroundStyle(Theme.muted)
                Picker("Encoder", selection: $settings.encoder) {
                    Text("CPU").tag(TranscodeEncoder.software)
                    Text("GPU").tag(TranscodeEncoder.vaapi)
                }
                .pickerStyle(.segmented)
                .disabled(!(caps?.supports(settings.codec, .vaapi) ?? false))
            }
            .listRowBackground(Theme.raised)
            VStack(alignment: .leading, spacing: 6) {
                Text("Resolution").font(.footnote).foregroundStyle(Theme.muted)
                Picker("Resolution", selection: $settings.resolution) {
                    Text("Keep").tag(TranscodeResolution.keep)
                    if !fits(.p1080) { Text(verbatim: "1080p").tag(TranscodeResolution.p1080) }
                    if !fits(.p720) { Text(verbatim: "720p").tag(TranscodeResolution.p720) }
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Theme.raised)
        } header: {
            Text("Video")
        } footer: {
            if let label = caps?.deviceLabel {
                Text("Detected: \(label)")
            } else if let reason = caps?.vaapiUnavailableReason {
                Text(verbatim: reason)
            }
        }
        .onChange(of: settings.codec) { _, codec in
            if !(caps?.supports(codec, settings.encoder) ?? true) { settings.encoder = .software }
        }
    }

    private var sizeSection: some View {
        Section("Size") {
            Picker("Mode", selection: $settings.mode) {
                Text("Quality").tag(TranscodeMode.quality)
                Text("Target size").tag(TranscodeMode.target)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Theme.raised)
            if settings.mode == .quality {
                Picker("Preset", selection: $settings.preset) {
                    Text("High").tag(TranscodePreset.high)
                    Text("Balanced").tag(TranscodePreset.balanced)
                    Text("Small").tag(TranscodePreset.small)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Theme.raised)
                .onChange(of: settings.preset) { _, _ in
                    settings.quality = nil
                    qualityText = ""
                }
                DisclosureGroup("Advanced") {
                    HStack {
                        Text("Quality value")
                        Spacer()
                        TextField(settings.encoder == .vaapi ? "QP" : "CRF", text: $qualityText)
                            .keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 70)
                            .onChange(of: qualityText) { _, text in settings.quality = Int(text) }
                    }
                    if settings.encoder == .software {
                        Picker("Speed", selection: $settings.speed) {
                            Text("Slower").tag(TranscodeSpeed.slower)
                            Text("Default").tag(TranscodeSpeed.default)
                            Text("Faster").tag(TranscodeSpeed.faster)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                .listRowBackground(Theme.raised)
            } else {
                HStack {
                    Text("GB per file (average)")
                    Spacer()
                    TextField("GB", value: $gbPerFile, format: .number.precision(.fractionLength(1)))
                        .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 70)
                }
                .listRowBackground(Theme.raised)
                if let kbps = effectiveSettings.targetVideoKbps {
                    Text("≈ \(String(format: "%.1f", Double(kbps) / 1000)) Mbps video")
                        .font(.caption).foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
            }
        }
    }

    private var audioSection: some View {
        Section {
            Toggle("Convert lossless audio to EAC3", isOn: $settings.convertLosslessAudio)
                .listRowBackground(Theme.raised)
            let changes = base?.audioChanges ?? []
            if changes.isEmpty {
                Text("No lossless audio tracks.").font(.caption).foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
            }
            ForEach(changes) { change in
                HStack {
                    Text(verbatim: change.label).font(.caption).foregroundStyle(Theme.muted)
                    Spacer()
                    if settings.convertLosslessAudio {
                        Text(verbatim: "→ \(change.to)").font(.caption).foregroundStyle(Theme.apricot)
                    } else {
                        Text("copy").font(.caption).foregroundStyle(Theme.faint)
                    }
                }
                .listRowBackground(Theme.raised)
            }
        } header: {
            Text("Audio & subtitles")
        } footer: {
            Text("Lossy tracks and all subtitles are always copied untouched.")
        }
    }

    // MARK: Actions

    private func fits(_ r: TranscodeResolution) -> Bool {
        guard let box = r.box, let e = base else { return false }
        return TranscodeMath.fitsBox(sourceWidth: e.sourceWidth, sourceHeight: e.sourceHeight, boxWidth: box.width, boxHeight: box.height)
    }

    private func loadCapabilities() async {
        guard let client = model.api() else { return }
        caps = try? await client.transcodeCapabilities()
    }

    private func fetch(_ s: TranscodeJobSettings, refine: Bool) async -> TranscodeEstimate? {
        guard let client = model.api() else { return nil }
        return try? await client.transcodeEstimate(selection: target.selection, settings: s, refine: refine)
    }

    private func refine() async {
        let s = effectiveSettings
        refining = true
        defer { refining = false }
        if let e = await fetch(s, refine: true) {
            refined = (s, e)
        } else {
            model.toast(String(localized: "Couldn't refine the estimate."), style: .error)
        }
    }

    private func submit() async {
        guard let client = model.api() else { return }
        submitting = true
        defer { submitting = false }
        do {
            let r = try await client.enqueueTranscode(selection: target.selection, settings: effectiveSettings)
            onQueued(r.count)
            dismiss()
        } catch {
            model.toast(String(localized: "Couldn't add to the re-encode queue."), style: .error)
        }
    }
}
```

- [ ] **Step 3: Wire the file row**

In `apps/ios/Rawkoon/Views/Detail/DetailFileRow.swift`:
1. Add a stored property after `let onRequestDelete: () -> Void`:
```swift
    /// Opens the re-encode sheet for this file; nil hides the action.
    var onReencode: (() -> Void)?
```
2. In `.contextMenu { … }`, before the existing `if isAdmin, mode == .movie {`, add:
```swift
            if isAdmin, let onReencode {
                Button {
                    onReencode()
                } label: {
                    Label("Re-encode…", systemImage: "gauge.with.dots.needle.67percent")
                }
            }
```
3. In the expanded block's bottom `HStack`, right after `Spacer()`, add:
```swift
                if isAdmin, let onReencode {
                    Button {
                        onReencode()
                    } label: {
                        Label("Re-encode…", systemImage: "gauge.with.dots.needle.67percent")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.apricot)
                }
```

- [ ] **Step 4: Wire seasons and episode files**

In `apps/ios/Rawkoon/Views/Detail/DetailSeasonsSection.swift`:
1. Add after `let onSeasonToggleMonitor: (Int, Bool) -> Void`:
```swift
    let onSeasonReencode: (Int) -> Void
    let onFileReencode: (LibraryFileInfo) -> Void
```
2. In `seasonMenu`, after the "Retry skipped" button, add:
```swift
            Button {
                onSeasonReencode(season.seasonNumber)
            } label: {
                Label("Re-encode season…", systemImage: "gauge.with.dots.needle.67percent")
            }
```
3. Every `DetailFileRow(` constructed in this file gets a trailing argument `onReencode: { onFileReencode(file) }` (use the row's file variable name at each call site).

- [ ] **Step 5: Wire the detail screen**

In `apps/ios/Rawkoon/Views/MediaDetailView.swift`:
1. Add state next to `pendingEpisodeDelete`:
```swift
    @State var reencodeTarget: ReencodeTarget?
```
2. In `seasonsSection`'s `DetailSeasonsSection(` call, after `onSeasonToggleMonitor: …,` add:
```swift
                onSeasonReencode: { season in
                    if let libraryId {
                        reencodeTarget = ReencodeTarget(
                            selection: TranscodeSelection(mediaId: libraryId, season: season),
                            subtitle: "\(title) · " + String(localized: "Season \(season)")
                        )
                    }
                },
                onFileReencode: { file in
                    reencodeTarget = ReencodeTarget(selection: TranscodeSelection(fileIds: [file.id]), subtitle: file.fileName)
                },
```
3. In `attachSheets`, append after the last `.sheet(item: $menuReleaseSearch) { … }`:
```swift
            .sheet(item: $reencodeTarget) { target in
                ReencodeSheet(target: target) { count in
                    model.toast(String(localized: "\(count) files added to the re-encode queue"), style: .success)
                }
                .environment(model)
            }
```

In `apps/ios/Rawkoon/Views/Detail/MediaDetailView+Management.swift`:
1. In the Manage overflow `Menu`, after the "Rescan files" button, add:
```swift
                    Button {
                        if let libraryId {
                            reencodeTarget = ReencodeTarget(selection: TranscodeSelection(mediaId: libraryId), subtitle: title)
                        }
                    } label: {
                        Label("Re-encode…", systemImage: "gauge.with.dots.needle.67percent")
                    }
```
2. In `fileRow(_:mode:)`, add the argument `onReencode: { reencodeTarget = ReencodeTarget(selection: TranscodeSelection(fileIds: [file.id]), subtitle: file.fileName) }` after `onRequestDelete:`.

- [ ] **Step 6: Add the catalog entries**

Create `/tmp/l10n-task3.json`:
```json
{
  "Re-encode": "Réencoder",
  "Re-encode…": "Réencoder…",
  "Re-encode season…": "Réencoder la saison…",
  "Codec": "Codec",
  "Widest support": "Le plus compatible",
  "Smallest files": "Fichiers les plus petits",
  "Encoder": "Encodeur",
  "CPU": "CPU",
  "GPU": "GPU",
  "Resolution": "Résolution",
  "Keep": "Garder",
  "Video": "Vidéo",
  "Detected: %@": "Détecté : %@",
  "Size": "Taille",
  "Mode": "Mode",
  "Quality": "Qualité",
  "Target size": "Taille cible",
  "Preset": "Préréglage",
  "High": "Haute",
  "Balanced": "Équilibré",
  "Small": "Petit",
  "Advanced": "Avancé",
  "Quality value": "Valeur de qualité",
  "Speed": "Vitesse",
  "Slower": "Plus lent",
  "Default": "Par défaut",
  "Faster": "Plus rapide",
  "GB per file (average)": "Go par fichier (moyenne)",
  "≈ %@ Mbps video": "≈ %@ Mb/s vidéo",
  "Convert lossless audio to EAC3": "Convertir l'audio sans perte en EAC3",
  "No lossless audio tracks.": "Aucune piste audio sans perte.",
  "copy": "copie",
  "Audio & subtitles": "Audio et sous-titres",
  "Lossy tracks and all subtitles are always copied untouched.": "Les pistes avec perte et tous les sous-titres sont toujours copiés tels quels.",
  "Frees now": "Libéré maintenant",
  "After seeding": "Après le partage",
  "Est. time": "Durée est.",
  "Estimating…": "Estimation…",
  "Refine estimate": "Affiner l'estimation",
  "Refine again": "Affiner à nouveau",
  "Sampling clips…": "Échantillonnage…",
  "Computed from bitrate × duration": "Calculé à partir du débit × durée",
  "Estimate outdated — settings changed": "Estimation périmée — réglages modifiés",
  "Rough estimate · bitrate model": "Estimation approximative · modèle de débit",
  "−%@ saved": "−%@ libérés",
  "Refined · %lld files · %lld clips": "Affiné · %lld fichiers · %lld extraits",
  "Couldn't refine the estimate.": "Impossible d'affiner l'estimation.",
  "Couldn't add to the re-encode queue.": "Impossible d'ajouter à la file de réencodage.",
  "Season %lld": "Saison %lld",
  "%lld files skipped": { "en": { "one": "%lld file skipped", "other": "%lld files skipped" }, "fr": { "one": "%lld fichier ignoré", "other": "%lld fichiers ignorés" } },
  "Add %lld files": { "en": { "one": "Add %lld file", "other": "Add %lld files" }, "fr": { "one": "Ajouter %lld fichier", "other": "Ajouter %lld fichiers" } },
  "%lld files added to the re-encode queue": { "en": { "one": "%lld file added to the re-encode queue", "other": "%lld files added to the re-encode queue" }, "fr": { "one": "%lld fichier ajouté à la file de réencodage", "other": "%lld fichiers ajoutés à la file de réencodage" } },
  "%lld files are still seeding. Their space frees when the torrents are removed; until then disk use grows by about %@.": { "en": { "one": "%lld file is still seeding. Its space frees when the torrent is removed; until then disk use grows by about %@.", "other": "%lld files are still seeding. Their space frees when the torrents are removed; until then disk use grows by about %@." }, "fr": { "one": "%lld fichier est encore en partage. Son espace sera libéré quand le torrent sera retiré ; d'ici là, l'espace disque augmente d'environ %@.", "other": "%lld fichiers sont encore en partage. Leur espace sera libéré quand les torrents seront retirés ; d'ici là, l'espace disque augmente d'environ %@." } }
}
```
The `≈ %@ Mbps video` key needs the view to interpolate a `String`: it already does (`String(format:)`). Run:
```bash
cd apps/ios && bun scripts/add-l10n.ts /tmp/l10n-task3.json && python3 scripts/check-l10n.py
```
Expected: `added N entries` then the checker exits 0. If the checker lists a missing key, add it to the JSON with its French text and re-run.

- [ ] **Step 7: Build and lint**

Run: mac-sync, then app-build, then lint.
Expected: `** BUILD SUCCEEDED **`; swiftformat and swiftlint report no violations (run `swiftformat Rawkoon` without `--lint` on the Mac, copy the reformatted files back with `rsync -a macbuild:~/build/rawkoon-reencode-ios/apps/ios/Rawkoon/ apps/ios/Rawkoon/`, and re-lint if it complains).

- [ ] **Step 8: Commit**

```bash
git add apps/ios/Rawkoon/Views/Reencode apps/ios/Rawkoon/Views/Detail apps/ios/Rawkoon/Views/MediaDetailView.swift apps/ios/Rawkoon/Localizable.xcstrings
git commit -m "feat(ios): re-encode sheet from file, season and title views"
```

---

### Task 4: Home card

**Files:**
- Create: `apps/ios/Rawkoon/Views/Reencode/ReencodeHomeCard.swift`
- Modify: `apps/ios/Rawkoon/Views/HomeView.swift`
- Modify: `apps/ios/Rawkoon/Localizable.xcstrings`

**Interfaces:**
- Consumes: `TranscodeSummary`, `APIClient.transcodeSummary()`, `DuskProgress`, `StatusBadge`.
- Produces: `struct ReencodeHomeCard: View { init() }` (self-loading, self-polling, renders nothing when hidden).

- [ ] **Step 1: Write the card**

`apps/ios/Rawkoon/Views/Reencode/ReencodeHomeCard.swift`:
```swift
import RawkoonKit
import SwiftUI

/// Admin Home widget: current re-encode, the next items, and totals. Polls while on screen.
struct ReencodeHomeCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isActiveRootTab) private var isActiveRootTab
    @State private var summary: TranscodeSummary?

    var body: some View {
        Group {
            if model.isAdmin, let summary, summary.show {
                NavigationLink {
                    ReencodeAdminView()
                } label: {
                    card(summary)
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: isActiveRootTab) {
            guard model.isAdmin, isActiveRootTab else { return }
            while !Task.isCancelled {
                if let client = model.api(), let s = try? await client.transcodeSummary() {
                    summary = s
                }
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    private func card(_ s: TranscodeSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Re-encode", systemImage: "gauge.with.dots.needle.67percent")
                    .font(.display(16)).foregroundStyle(Theme.textStrong)
                Spacer()
                stateBadge(s)
            }
            if let job = s.current {
                current(job)
            } else {
                Text("\(s.queuedCount) queued").font(.subheadline).foregroundStyle(Theme.muted)
            }
            if !s.next.isEmpty {
                VStack(spacing: 4) {
                    ForEach(s.next) { job in
                        HStack {
                            Text(verbatim: job.title).lineLimit(1)
                            Spacer()
                            Text(verbatim: Formatters.bytesEcho(job.sourceBytes)).font(.system(.caption, design: .monospaced))
                        }
                        .font(.caption).foregroundStyle(Theme.muted)
                    }
                    let more = s.queuedCount - s.next.count
                    if more > 0 {
                        HStack {
                            Text("+ \(more) more")
                            Spacer()
                            Text(verbatim: "~" + (Formatters.durationCompact(Double(s.queuedEtaSecs)) ?? "0m"))
                        }
                        .font(.caption).foregroundStyle(Theme.faint)
                    }
                }
            }
            Divider().overlay(Theme.border)
            HStack {
                Text("−\(Formatters.bytesEcho(s.savedBytes30d)) saved · \(s.doneCount30d) done")
                    .foregroundStyle(Theme.seed)
                if s.failedCount > 0 {
                    Text("\(s.failedCount) failed").foregroundStyle(Theme.terracotta)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.faint)
            }
            .font(.caption)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func current(_ job: TranscodeJob) -> some View {
        let progress = job.live?.progress ?? job.progress ?? 0
        return VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: job.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textStrong).lineLimit(1)
            Text(verbatim: "\(job.settings.codec.rawValue.uppercased()) · \(job.settings.encoder == .vaapi ? "GPU" : "CPU")")
                .font(.caption2).foregroundStyle(Theme.faint)
            DuskProgress(value: progress)
            HStack {
                Text(verbatim: "\(Int((progress * 100).rounded()))%" + (job.live?.fps.map { " · \(Int($0)) fps" } ?? ""))
                Spacer()
                if let eta = job.live?.etaSecs {
                    Text("~\(Formatters.durationCompact(Double(eta)) ?? "0m") left")
                }
            }
            .font(.caption).foregroundStyle(Theme.muted)
        }
    }

    @ViewBuilder
    private func stateBadge(_ s: TranscodeSummary) -> some View {
        switch s.state {
        case "running": StatusBadge(text: "Running", tint: Theme.seed)
        case "paused": StatusBadge(text: "Paused", tint: Theme.apricot)
        case "waiting_window": StatusBadge(text: "Waits for \(s.windowStart)", tint: Theme.importing)
        default: StatusBadge(text: "Idle", tint: Theme.muted)
        }
    }
}
```

- [ ] **Step 2: Add it to Home**

In `apps/ios/Rawkoon/Views/HomeView.swift`, inside `widgets`, after `if model.isAdmin { downloadsWidget }`, add:
```swift
            if model.isAdmin {
                ReencodeHomeCard()
            }
```

- [ ] **Step 3: Add catalog entries**

`/tmp/l10n-task4.json`:
```json
{
  "%lld queued": "%lld en file",
  "+ %lld more": "+ %lld autres",
  "−%@ saved · %lld done": "−%@ libérés · %lld terminés",
  "%lld failed": { "en": { "one": "%lld failed", "other": "%lld failed" }, "fr": { "one": "%lld échec", "other": "%lld échecs" } },
  "~%@ left": "~%@ restant",
  "Running": "En cours",
  "Paused": "En pause",
  "Waits for %@": "Attend %@",
  "Idle": "Inactif"
}
```
Run: `cd apps/ios && bun scripts/add-l10n.ts /tmp/l10n-task4.json && python3 scripts/check-l10n.py`
Expected: entries added; checker exits 0 (if "Running"/"Paused"/"Idle" already exist the tool skips them).

- [ ] **Step 4: Build**

Run: mac-sync, then app-build.
Expected: `** BUILD SUCCEEDED **`. (`ReencodeAdminView` is created in Task 5; until then add a temporary `struct ReencodeAdminView: View { var body: some View { EmptyView() } }` at the bottom of `ReencodeHomeCard.swift` and delete it in Task 5 Step 1.)

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/Views/Reencode/ReencodeHomeCard.swift apps/ios/Rawkoon/Views/HomeView.swift apps/ios/Rawkoon/Localizable.xcstrings
git commit -m "feat(ios): show the re-encode queue on Home"
```

---

### Task 5: Admin screen

**Files:**
- Create: `apps/ios/Rawkoon/Views/Settings/admin/ReencodeAdminView.swift`
- Modify: `apps/ios/Rawkoon/Views/Settings/SettingsDestination.swift`
- Modify: `apps/ios/Rawkoon/Views/Reencode/ReencodeHomeCard.swift` (remove the Task 4 stub)
- Modify: `apps/ios/Rawkoon/Localizable.xcstrings`

**Interfaces:**
- Consumes: all Task 2 API methods; `TranscodeMath.movePlacement`, `stepIndex`, `minutes(fromHHMM:)`, `hhmm(fromMinutes:)`.
- Produces: `struct ReencodeAdminView: View { init() }`; `SettingsDestination.reencode`.

- [ ] **Step 1: Write the admin view**

Delete the stub `ReencodeAdminView` from `ReencodeHomeCard.swift`. Create `apps/ios/Rawkoon/Views/Settings/admin/ReencodeAdminView.swift`:
```swift
import RawkoonKit
import SwiftUI

/// Settings → Jobs & Releases → Re-encode: queue controls, running job, queue, history.
struct ReencodeAdminView: View {
    @Environment(AppModel.self) private var model

    @State private var active: [TranscodeJob] = []
    @State private var history: [TranscodeJob] = []
    @State private var settings: TranscodeQueueSettings?
    @State private var summary: TranscodeSummary?
    @State private var loading = true
    @State private var loadError: String?
    @State private var busyIds: Set<Int> = []
    @State private var confirmCancel: TranscodeJob?
    @State private var confirmClear = false
    @State private var cpuThreadsText = ""

    private var running: TranscodeJob? { active.first { $0.status == "running" } }
    private var queued: [TranscodeJob] { active.filter { $0.status == "queued" } }

    /// Consecutive runs of the same batch, in queue order.
    private var batches: [(id: String, jobs: [TranscodeJob])] {
        var out: [(id: String, jobs: [TranscodeJob])] = []
        for job in queued {
            if let last = out.last, last.id == job.batchId {
                out[out.count - 1].jobs.append(job)
            } else {
                out.append((job.batchId, [job]))
            }
        }
        return out
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                content
            }
        }
        .navigationTitle("Re-encode")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await reloadAll() } }) {
                statusSection
                overviewSection
                if let running { runningSection(running) }
                queueSections
                historySection
                advancedSection
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            ToolbarItem(placement: .primaryAction) { EditButton() }
            ToolbarItem(placement: .secondaryAction) {
                Button("Clear finished", role: .destructive) { confirmClear = true }
            }
        }
        .task { await pollLoop() }
        .rawkoonConfirm(
            "Cancel this re-encode?",
            isPresented: Binding(get: { confirmCancel != nil }, set: { if !$0 { confirmCancel = nil } }),
            presenting: confirmCancel
        ) { job in
            Button("Cancel re-encode", role: .destructive) { Task { await cancel(job) } }
        } message: { _ in
            Text("The original file is kept; the partial output is deleted.")
        }
        .rawkoonConfirm("Clear finished jobs?", isPresented: $confirmClear) {
            Button("Clear finished", role: .destructive) { Task { await clearHistory() } }
        }
    }

    // MARK: Sections

    private var statusSection: some View {
        Section("Status") {
            HStack {
                stateBadge
                Spacer()
                if let settings {
                    Button(settings.paused ? "Resume queue" : "Pause queue") {
                        Task { await patch(TranscodeSettingsPatch(paused: !settings.paused)) }
                    }
                }
            }
            .listRowBackground(Theme.raised)
            if let settings {
                Toggle("Run window", isOn: Binding(
                    get: { settings.windowEnabled },
                    set: { value in Task { await patch(TranscodeSettingsPatch(windowEnabled: value)) } }
                ))
                .listRowBackground(Theme.raised)
                if settings.windowEnabled {
                    timeRow("Start", settings.windowStart) { Task { await patch(TranscodeSettingsPatch(windowStart: $0)) } }
                    timeRow("End", settings.windowEnd) { Task { await patch(TranscodeSettingsPatch(windowEnd: $0)) } }
                }
            }
        }
    }

    private var overviewSection: some View {
        Section("Overview") {
            if let s = summary {
                LabeledContent("Queued", value: "\(s.queuedCount) · ~\(Formatters.durationCompact(Double(s.queuedEtaSecs)) ?? "0m") · \(Formatters.bytesEcho(s.queuedSourceBytes))")
                LabeledContent("Saved (30 days)", value: Formatters.bytesEcho(s.savedBytes30d))
                LabeledContent("Frees after seeding", value: Formatters.bytesEcho(s.freesAfterSeedingBytes))
                LabeledContent("Failed", value: String(s.failedCount))
            }
        }
        .listRowBackground(Theme.raised)
    }

    private func runningSection(_ job: TranscodeJob) -> some View {
        let progress = job.live?.progress ?? job.progress ?? 0
        let step = TranscodeMath.stepIndex(job.step)
        return Section("Now encoding") {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: job.title).font(.headline).foregroundStyle(Theme.textStrong)
                Text(verbatim: settingsSummary(job.settings)).font(.caption).foregroundStyle(Theme.muted)
                HStack(spacing: 4) {
                    stepChip("Encoding", index: 0, current: step, suffix: step == 0 ? " \(Int((progress * 100).rounded()))%" : "")
                    stepChip("Validating", index: 1, current: step, suffix: "")
                    stepChip("Replacing", index: 2, current: step, suffix: "")
                    stepChip("Rescan", index: 3, current: step, suffix: "")
                }
                DuskProgress(value: progress)
                HStack {
                    if let fps = job.live?.fps { Text(verbatim: "\(Int(fps)) fps") }
                    Spacer()
                    if let eta = job.live?.etaSecs { Text("~\(Formatters.durationCompact(Double(eta)) ?? "0m") left") }
                }
                .font(.caption).foregroundStyle(Theme.muted)
                Button("Cancel re-encode", role: .destructive) { confirmCancel = job }
            }
            .listRowBackground(Theme.raised)
        }
    }

    @ViewBuilder
    private var queueSections: some View {
        if queued.isEmpty {
            Section("Queue") {
                Text("Nothing queued. Open a movie or show and choose Re-encode.")
                    .foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
            }
        }
        ForEach(batches, id: \.id) { batch in
            Section {
                ForEach(batch.jobs) { job in
                    queueRow(job)
                }
                .onMove { source, destination in
                    Task { await move(in: batch.jobs, from: source, to: destination) }
                }
            } header: {
                HStack {
                    Text(verbatim: batch.jobs.first?.title.components(separatedBy: " — ").first ?? "")
                    Spacer()
                    Menu {
                        Button("Move batch to top") { Task { await moveBatchTop(batch.id) } }
                        Button("Remove all", role: .destructive) { Task { await removeBatch(batch.id) } }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
    }

    private func queueRow(_ job: TranscodeJob) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: job.title).foregroundStyle(Theme.text)
            Text(verbatim: "\(settingsSummary(job.settings)) · \(Formatters.bytesEcho(job.sourceBytes))" + (job.estimatedBytes.map { " → ~\(Formatters.bytesEcho($0))" } ?? ""))
                .font(.footnote).foregroundStyle(Theme.muted)
        }
        .listRowBackground(Theme.raised)
        .swipeActions {
            Button("Remove", role: .destructive) { Task { await cancel(job) } }
            Button("Move to top") { Task { await moveTop(job) } }.tint(Theme.apricot)
        }
        .overlay(alignment: .trailing) {
            if busyIds.contains(job.id) { ProgressView().tint(Theme.muted) }
        }
    }

    private var historySection: some View {
        Section("History") {
            if history.isEmpty {
                Text("No finished re-encodes in the last 30 days.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
            }
            ForEach(history) { job in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(verbatim: job.title).foregroundStyle(Theme.text)
                        Spacer()
                        resultBadge(job)
                    }
                    Text(verbatim: historyLine(job)).font(.footnote).foregroundStyle(Theme.muted)
                    if job.status == "failed", let error = job.error {
                        Text(verbatim: error).font(.caption).foregroundStyle(Theme.terracotta)
                    }
                }
                .listRowBackground(Theme.raised)
                .swipeActions {
                    if job.status == "failed" || job.status == "cancelled" {
                        Button("Retry") { Task { await retry(job) } }.tint(Theme.apricot)
                    }
                }
            }
        }
    }

    private var advancedSection: some View {
        Section {
            DisclosureGroup("Advanced") {
                if let settings {
                    Stepper(value: Binding(
                        get: { settings.ssimThreshold },
                        set: { value in Task { await patch(TranscodeSettingsPatch(ssimThreshold: value)) } }
                    ), in: 0.9 ... 0.999, step: 0.005) {
                        LabeledContent("SSIM mean threshold", value: String(format: "%.3f", settings.ssimThreshold))
                    }
                    Stepper(value: Binding(
                        get: { settings.ssimClipMin },
                        set: { value in Task { await patch(TranscodeSettingsPatch(ssimClipMin: value)) } }
                    ), in: 0.85 ... 0.999, step: 0.005) {
                        LabeledContent("SSIM per-clip minimum", value: String(format: "%.3f", settings.ssimClipMin))
                    }
                    HStack {
                        Text("CPU threads")
                        Spacer()
                        TextField("Auto", text: $cpuThreadsText)
                            .keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 70)
                            .onSubmit { Task { await saveThreads() } }
                    }
                }
            }
            .listRowBackground(Theme.raised)
        }
    }

    // MARK: Pieces

    @ViewBuilder
    private var stateBadge: some View {
        switch summary?.state {
        case "running": StatusBadge(text: "Running", tint: Theme.seed)
        case "paused": StatusBadge(text: "Paused", tint: Theme.apricot)
        case "waiting_window": StatusBadge(text: "Waits for \(summary?.windowStart ?? "")", tint: Theme.importing)
        default: StatusBadge(text: "Idle", tint: Theme.muted)
        }
    }

    private func timeRow(_ title: LocalizedStringKey, _ hhmm: String, onChange: @escaping (String) -> Void) -> some View {
        let minutes = TranscodeMath.minutes(fromHHMM: hhmm) ?? 0
        let date = Calendar.current.startOfDay(for: Date()).addingTimeInterval(TimeInterval(minutes * 60))
        return DatePicker(title, selection: Binding(
            get: { date },
            set: { value in
                let c = Calendar.current.dateComponents([.hour, .minute], from: value)
                onChange(TranscodeMath.hhmm(fromMinutes: (c.hour ?? 0) * 60 + (c.minute ?? 0)))
            }
        ), displayedComponents: .hourAndMinute)
            .listRowBackground(Theme.raised)
    }

    private func stepChip(_ title: LocalizedStringKey, index: Int, current: Int?, suffix: String) -> some View {
        let done = (current ?? -1) > index
        let now = current == index
        return HStack(spacing: 0) {
            Text(title)
            Text(verbatim: suffix)
        }
            .font(.caption2.weight(now ? .semibold : .regular))
            .foregroundStyle(now ? Theme.textStrong : done ? Theme.muted : Theme.faint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 6)
            .overlay(alignment: .top) {
                Capsule().fill(now ? Theme.apricot : done ? Theme.seed : Theme.border).frame(height: 3)
            }
    }

    private func resultBadge(_ job: TranscodeJob) -> some View {
        switch job.status {
        case "done": StatusBadge(text: (job.sourceNlink ?? 1) > 1 ? "Replaced · seeding" : "Replaced", tint: Theme.seed)
        case "failed": StatusBadge(text: "Failed", tint: Theme.terracotta)
        default: StatusBadge(text: "Cancelled", tint: Theme.muted)
        }
    }

    private func settingsSummary(_ s: TranscodeJobSettings) -> String {
        var parts = [s.codec.rawValue.uppercased(), s.encoder == .vaapi ? "GPU" : "CPU"]
        switch s.resolution {
        case .keep: break
        case .p1080: parts.append("→1080p")
        case .p720: parts.append("→720p")
        }
        parts.append(s.mode == .target ? String(format: "%.1f Mbps", Double(s.targetVideoKbps ?? 0) / 1000) : s.preset.rawValue)
        if s.convertLosslessAudio { parts.append("EAC3") }
        return parts.joined(separator: " · ")
    }

    private func historyLine(_ job: TranscodeJob) -> String {
        guard job.status == "done", let out = job.outputBytes else {
            return String(localized: "\(Formatters.bytesEcho(job.sourceBytes)) kept")
        }
        var line = "\(Formatters.bytesEcho(job.sourceBytes)) → \(Formatters.bytesEcho(out))"
        if let ssim = job.ssimAvg { line += String(format: " · SSIM %.3f", ssim) }
        return line
    }

    // MARK: Data

    private func pollLoop() async {
        await reloadAll()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(running == nil ? 10 : 2))
            guard !Task.isCancelled else { return }
            await reloadActive()
        }
    }

    private func reloadAll() async {
        guard let client = model.api() else { loading = false; return }
        do {
            async let a = client.transcodeJobs(active: true)
            async let h = client.transcodeJobs(active: false)
            async let s = client.transcodeSettings()
            async let sum = client.transcodeSummary()
            active = try await a
            history = try await h
            settings = try await s
            summary = try await sum
            cpuThreadsText = settings?.cpuThreads.map(String.init) ?? ""
            loadError = nil
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func reloadActive() async {
        guard let client = model.api() else { return }
        let wasRunning = running?.id
        if let a = try? await client.transcodeJobs(active: true) { active = a }
        if let s = try? await client.transcodeSummary() { summary = s }
        // A job just finished: its result moved to history.
        if wasRunning != nil, running?.id != wasRunning, let h = try? await client.transcodeJobs(active: false) {
            history = h
        }
    }

    private func run(_ id: Int?, failure: String, _ action: (APIClient) async throws -> Void) async {
        guard let client = model.api() else { return }
        if let id { busyIds.insert(id) }
        defer { if let id { busyIds.remove(id) } }
        do {
            try await action(client)
        } catch {
            model.toast(failure, style: .error)
        }
        await reloadAll()
    }

    private func patch(_ p: TranscodeSettingsPatch) async {
        await run(nil, failure: String(localized: "Couldn't update re-encode settings.")) { client in
            settings = try await client.updateTranscodeSettings(p)
        }
    }

    private func saveThreads() async {
        let trimmed = cpuThreadsText.trimmingCharacters(in: .whitespaces)
        await patch(TranscodeSettingsPatch(cpuThreads: .some(trimmed.isEmpty ? nil : Int(trimmed))))
    }

    private func cancel(_ job: TranscodeJob) async {
        let index = active.firstIndex { $0.id == job.id }
        if job.status == "queued", let index { active.remove(at: index) } // optimistic
        await run(job.id, failure: String(localized: "Couldn't cancel.")) { try await $0.cancelTranscodeJob(id: job.id) }
    }

    private func moveTop(_ job: TranscodeJob) async {
        await run(job.id, failure: String(localized: "Couldn't move.")) { try await $0.moveTranscodeJob(id: job.id, placement: nil) }
    }

    private func move(in jobs: [TranscodeJob], from source: IndexSet, to destination: Int) async {
        guard let move = TranscodeMath.movePlacement(ids: jobs.map(\.id), from: source, to: destination) else { return }
        await run(move.id, failure: String(localized: "Couldn't move.")) {
            try await $0.moveTranscodeJob(id: move.id, placement: move.placement)
        }
    }

    private func moveBatchTop(_ batchId: String) async {
        await run(nil, failure: String(localized: "Couldn't move.")) { try await $0.moveTranscodeBatchToTop(id: batchId) }
    }

    private func removeBatch(_ batchId: String) async {
        await run(nil, failure: String(localized: "Couldn't remove.")) { try await $0.removeTranscodeBatch(id: batchId) }
    }

    private func retry(_ job: TranscodeJob) async {
        await run(job.id, failure: String(localized: "Couldn't retry.")) { try await $0.retryTranscodeJob(id: job.id) }
    }

    private func clearHistory() async {
        await run(nil, failure: String(localized: "Couldn't clear history.")) { try await $0.clearTranscodeHistory() }
    }
}
```
(`rawkoonConfirm` is the app's window-level alert wrapper — `confirmationDialog` anchors off-screen on iOS 26 scroll views.)

- [ ] **Step 2: Register the destination**

In `apps/ios/Rawkoon/Views/Settings/SettingsDestination.swift`:
- Add `case reencode` after `case jobs`.
- `group`: change `case .jobs, .releases:` to `case .jobs, .reencode, .releases:`.
- `titleKey`: `case .reencode: "Re-encode"`.
- `systemImage`: `case .reencode: "gauge.with.dots.needle.67percent"`.
- `keywords`: `case .reencode: ["re-encode", "transcode", "hevc", "av1", "queue", "compress"]`.
- `destination`: `case .reencode: ReencodeAdminView()`.

- [ ] **Step 3: Add catalog entries**

`/tmp/l10n-task5.json`:
```json
{
  "Status": "État",
  "Resume queue": "Reprendre la file",
  "Pause queue": "Mettre la file en pause",
  "Run window": "Plage horaire",
  "Start": "Début",
  "End": "Fin",
  "Overview": "Vue d'ensemble",
  "Queued": "En file",
  "Saved (30 days)": "Libéré (30 jours)",
  "Frees after seeding": "Libéré après le partage",
  "Failed": "Échec",
  "Now encoding": "Encodage en cours",
  "Encoding": "Encodage",
  "Validating": "Validation",
  "Replacing": "Remplacement",
  "Rescan": "Rescan",
  "Cancel re-encode": "Annuler le réencodage",
  "Cancel this re-encode?": "Annuler ce réencodage ?",
  "The original file is kept; the partial output is deleted.": "Le fichier original est conservé ; la sortie partielle est supprimée.",
  "Queue": "File",
  "Nothing queued. Open a movie or show and choose Re-encode.": "Rien en file. Ouvrez un film ou une série et choisissez Réencoder.",
  "Move batch to top": "Mettre le lot en tête",
  "Remove all": "Tout retirer",
  "Remove": "Retirer",
  "Move to top": "Mettre en tête",
  "History": "Historique",
  "No finished re-encodes in the last 30 days.": "Aucun réencodage terminé ces 30 derniers jours.",
  "Retry": "Réessayer",
  "SSIM mean threshold": "Seuil SSIM moyen",
  "SSIM per-clip minimum": "SSIM minimum par extrait",
  "CPU threads": "Threads CPU",
  "Auto": "Auto",
  "Clear finished": "Vider les terminés",
  "Clear finished jobs?": "Vider les tâches terminées ?",
  "Replaced": "Remplacé",
  "Replaced · seeding": "Remplacé · en partage",
  "Cancelled": "Annulé",
  "%@ kept": "%@ conservés",
  "Couldn't update re-encode settings.": "Impossible de mettre à jour les réglages de réencodage.",
  "Couldn't cancel.": "Impossible d'annuler.",
  "Couldn't move.": "Impossible de déplacer.",
  "Couldn't remove.": "Impossible de retirer.",
  "Couldn't retry.": "Impossible de réessayer.",
  "Couldn't clear history.": "Impossible de vider l'historique."
}
```
Run: `cd apps/ios && bun scripts/add-l10n.ts /tmp/l10n-task5.json && python3 scripts/check-l10n.py`
Expected: checker exits 0.

- [ ] **Step 4: Build and lint**

Run: mac-sync, app-build, lint.
Expected: `** BUILD SUCCEEDED **`, no lint violations.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/Views/Settings apps/ios/Rawkoon/Views/Reencode/ReencodeHomeCard.swift apps/ios/Rawkoon/Localizable.xcstrings
git commit -m "feat(ios): add the re-encode admin screen"
```

---

### Task 6: Notification routing

**Files:**
- Modify: `apps/ios/Rawkoon/NotificationDestination.swift`
- Modify: `apps/ios/Rawkoon/Views/Notifications/NotificationDestinationView.swift`
- Modify: `apps/ios/Rawkoon/Views/Notifications/NotificationLeadingVisual.swift`
- Test: `apps/ios/RawkoonTests/NotificationDestinationTests.swift`

**Interfaces:**
- Produces: `NotificationDestination.transcode` (id `"transcode"`), resolved from `/settings?tab=transcode`.

- [ ] **Step 1: Write the failing test**

`apps/ios/RawkoonTests/NotificationDestinationTests.swift`:
```swift
@testable import Rawkoon
import Testing

struct NotificationDestinationTests {
    @Test func settingsTranscodeTabRoutesToReencode() {
        #expect(NotificationDestination.resolve(url: "/settings?tab=transcode") == .transcode)
    }

    @Test func otherSettingsTabsStayUnrouted() {
        #expect(NotificationDestination.resolve(url: "/settings?tab=users") == nil)
        #expect(NotificationDestination.resolve(url: "/settings") == nil)
    }

    @Test func existingRoutesUnchanged() {
        #expect(NotificationDestination.resolve(url: "/requests") == .requests)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: mac-sync, app-test with suite `NotificationDestinationTests`.
Expected: build error `type 'NotificationDestination' has no member 'transcode'`.

- [ ] **Step 3: Implement**

In `NotificationDestination.swift`:
- Add after `case requests`:
```swift
    /// `/settings?tab=transcode` (re-encode finished / failed).
    case transcode
```
- In `id`, add `case .transcode: "transcode"`.
- In `resolve`, add before `default:`:
```swift
        case "settings":
            let tab = components.queryItems?.first(where: { $0.name == "tab" })?.value
            return tab == "transcode" ? .transcode : nil
```

In `NotificationDestinationView.swift`:
- In `content`'s switch add `case .transcode: ReencodeAdminView()`.
- In `load()`'s switch add `.transcode` to the `case .requests:` arm: `case .requests, .transcode: break`.

In `NotificationLeadingVisual.swift`, add to `typeStyles` after `"library_attention": failStyle,`:
```swift
    "library_transcode_finished": libraryStyle,
    "library_transcode_failed": failStyle,
```

- [ ] **Step 4: Run to verify it passes**

Run: mac-sync, app-test with suite `NotificationDestinationTests`, then the full `RawkoonTests` (drop `/<Suite>` from `-only-testing`).
Expected: 3 new tests pass; the full RawkoonTests suite passes (including `SSEEventRegistryTests`, unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/NotificationDestination.swift apps/ios/Rawkoon/Views/Notifications apps/ios/RawkoonTests/NotificationDestinationTests.swift
git commit -m "feat(ios): open re-encode notifications on the admin screen"
```

---

### Task 7: Full verification and device install

**Files:** none new (fixes only if a check fails).

- [ ] **Step 1: Whole-package and app checks**

Run on the Mac after mac-sync:
```bash
ssh macbuild 'cd ~/build/rawkoon-reencode-ios/apps/ios && swift test 2>&1 | tail -5'
```
then app-test without `-only-testing` suite filter (`-only-testing:RawkoonTests`), then lint, then locally `cd apps/ios && python3 scripts/check-l10n.py && python3 scripts/check-env-inject.py`.
Expected: every command exits 0; `swift test` reports all RawkoonKit tests passing.

- [ ] **Step 2: Install on the iPhone**

Build a signed debug build and install it on the connected iPhone from the Mac (never TestFlight for testing):
```bash
ssh macbuild 'cd ~/build/rawkoon-reencode-ios/apps/ios && xcodegen generate >/dev/null \
  && DEVICE=$(xcrun devicectl list devices --hide-headers 2>/dev/null | awk "/iPhone/ && /connected|available/ {print \$3; exit}") \
  && echo "device=$DEVICE" \
  && xcodebuild -project Rawkoon.xcodeproj -scheme Rawkoon -configuration Debug -destination "id=$DEVICE" -allowProvisioningUpdates build 2>&1 | tail -5'
```
If signing fails over SSH (`errSecInternalComponent` or "No Account for Team"), follow the documented headless recipe used for the other iOS project on this Mac: mint a development profile via the App Store Connect API key, re-sign, and run the `codesign` / `xcrun devicectl device install app` step inside the GUI login session with `launchctl asuser`.
Expected: `** BUILD SUCCEEDED **` and `App installed` from devicectl.

- [ ] **Step 3: Manual pass on the device (server running the re-encode queue)**

Check each and note results:
1. Movie → Manage → "Re-encode…" opens the sheet; GPU disabled with a reason when the server has no VAAPI; 1080p/720p hidden for a 1080p source.
2. Change codec → estimate updates within ~1 s; "Refine estimate" → footer "Refined · …"; change preset → "Estimate outdated".
3. Target size mode → Mbps footer appears, Refine hidden.
4. Show → season menu "Re-encode season…" and an episode file's context menu "Re-encode…" both open the sheet with the right subtitle; skipped files listed.
5. Add → toast; Home shows the Re-encode card with progress that advances every ~5 s; tap opens the admin screen.
6. Admin screen: pause/resume, run window toggle + times, drag within a batch, swipe Move to top / Remove, Cancel running job (confirmation), Retry a failed job, Clear finished.
7. Navigate away from the admin screen and Home, then watch the server log for 30 s: no further `/api/transcode/jobs` or `/summary` requests (Review Focus 4).
8. Tap a re-encode push notification → admin screen opens.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A apps/ios
git commit -m "fix(ios): re-encode screens follow-ups from device testing"
```
(Only if Steps 1–3 required changes.)

---

## Self-Review Notes

- Spec coverage: entry points (T3), sheet sections/behaviour (T3), Home card (T4), admin screen incl. run window, stats, running job, queue with batches/reorder/swipes, history/retry/clear, advanced (T5), notifications + visuals (T6), networking/models/casing (T2), RawkoonKit helpers (T1), l10n (every task), Catalyst toolbar buttons (T3 sheet), testing + device install (T7).
- The spec's `transcodeSettingsKey` helper is replaced by making `TranscodeJobSettings` `Hashable` and comparing it directly (same effect, less code).
- Type names across tasks: `TranscodeJobSettings`, `TranscodeSelection`, `TranscodeResolution.box`, `TranscodeCapabilities.supports`, `TranscodeMath.movePlacement` → `TranscodeMove` (`id`, `placement`), `TranscodeMovePlacement.before/after` — defined in T1/T2 and used unchanged in T3–T6.
