# Phase 1: Lint, format, and logging guardrails - Pattern Map

**Mapped:** 2026-09-01
**Files analyzed:** 9 (1 workflow, 2 new config, 1 new logger file, 4 modified Swift files, 1 new docs page, project.yml checked but likely untouched)
**Analogs found:** 6 / 9 (3 have no in-repo analog by design — greenfield tooling; conventions of neighboring files substituted per the scope note)

All paths below were verified with `git ls-files` — every named analog is tracked source, not a generated/gitignored mirror.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.github/workflows/ios.yml` (new `lint` job + `build` gains `needs:`) | CI config | batch (static analysis) | The file's own `kit` job (cheap/parallel runner) and `build` job (`needs:` wiring, brew-install step) | exact — same file, same house style |
| `apps/ios/.swiftlint.yml` | config | batch | none in-repo (greenfield) | no analog — anchor on RESEARCH.md's verified skeleton + repo's own worst-offender line counts |
| `apps/ios/.swiftformat` | config | batch | none in-repo (greenfield) | no analog — anchor on `project.yml`'s `SWIFT_VERSION: "5.0"` as the one hard constraint |
| `apps/ios/Rawkoon/Logging.swift` (new) | utility (namespace/factory) | event-driven (log emission) | none for `os.Logger` usage; closest structural analog for "enum-as-namespace, static lets" is `FileStore.swift` (`enum FileStore { static func ... }`) | role-match — namespace shape only, not logging content |
| `apps/ios/Rawkoon/AudiobookPlayer.swift` (modify: 2 `try?` sites) | service/controller (`ObservableObject`) | event-driven (AV session + async fetch) | itself — existing `do/catch` idiom used elsewhere in `AppModel.swift`'s `startDownload` | partial — file has zero existing `do/catch`, so the conversion imports the pattern from `AppModel.swift` |
| `apps/ios/Rawkoon/ChapterDownloader.swift` (modify: 1 `try?` site, line ~205) | service (`URLSessionDownloadDelegate`) | event-driven (download callback) | itself — the file already has a `do/catch` block 8 lines below the `try?` site (`fileManager.moveItem`) | exact — the do/catch idiom to copy is in the same function |
| `apps/ios/Rawkoon/AppModel.swift` (modify: `refreshGrants`, 1 `try?` site) | controller/store (`ObservableObject`, `@MainActor` state) | CRUD + event-driven | itself — `startDownload` (lines 307-339) is the file's existing `do/catch` + `errorMessage` pattern | exact — same file, same class, established error-surfacing convention |
| `apps/ios/docs/code-quality-audit.md` → new sibling doc for LOG-04 | docs | — | itself (only file currently in `apps/ios/docs/`) | exact — only existing doc in that directory |
| `apps/ios/project.yml` | config (XcodeGen) | — | itself; `sources: [Rawkoon]` is a directory glob | exact — confirms no edit needed for `Logging.swift` |

## Pattern Assignments

### `.github/workflows/ios.yml` (CI config, batch)

**Analog:** the file itself — `kit` and `build` jobs (lines 18-38)

**Existing job shape to copy** (`.github/workflows/ios.yml:18-38`):
```yaml
jobs:
  kit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swift-actions/setup-swift@v2
        with:
          swift-version: "6.0"
      - run: swift test
        working-directory: apps/ios

  build:
    runs-on: macos-26
    needs: kit
    steps:
      - uses: actions/checkout@v4
      - name: Select Xcode 26 (iOS 26 SDK required by App Store)
        run: sudo xcode-select -s "$(ls -d /Applications/Xcode_26*.app 2>/dev/null | sort -V | tail -1 || echo /Applications/Xcode.app)"
      - run: brew install xcodegen
      - run: xcodegen generate
        working-directory: apps/ios
      - name: Build for simulator
        working-directory: apps/ios
        run: |
          xcodebuild build \
            -project Rawkoon.xcodeproj -scheme Rawkoon \
            -destination 'generic/platform=iOS Simulator' \
            CODE_SIGNING_ALLOWED=NO
```

**What to copy for the new `lint` job:**
- Runner choice: match `kit`'s `runs-on: ubuntu-latest` (RESEARCH.md's own recommendation — SwiftLint/SwiftFormat only read source text, no Xcode needed), not `build`'s `macos-26`.
- `checkout@v4` as the first step, same as every existing job.
- `brew install <tool1> <tool2>` as a single bare `- run:` step, exactly matching `build`'s `- run: brew install xcodegen` (no `name:`, no version pin) — house style is "trust brew's current formula."
- `working-directory: apps/ios` on every step that runs a tool against the source tree, matching every existing job's convention (never `cd` inline).
- No `- name:` on simple one-line steps (see `brew install xcodegen`); use `- name:` only for steps whose intent isn't obvious from the command (see `Select Xcode 26 ...`).

**`needs:` wiring pattern to copy** (line 31): `build:` currently has `needs: kit` (single-value list-of-one). Change to `needs: [kit, lint]` — the file has no existing multi-value `needs:` example, so use plain YAML list syntax (`[kit, lint]`), consistent with GitHub Actions' own convention and this file's flow-style usage elsewhere (e.g. `UIBackgroundModes: [audio, fetch, remote-notification]` in `project.yml` — same repo's flow-list convention, for consistency of style even though it's a different file).

**Trigger paths note:** the top-level `on:` block (lines 2-17) filters on `paths: ["apps/ios/**", ".github/workflows/ios.yml"]` for both `push` and `pull_request` — new `.swiftlint.yml`/`.swiftformat` under `apps/ios` are automatically in scope, no `on:` edit needed.

---

### `apps/ios/.swiftlint.yml` (config, no in-repo analog)

**No analog exists** — confirmed by RESEARCH.md (grep for `.swiftlint.yml` anywhere in repo returned zero hits) and independently by this pass. Anchor on:
- RESEARCH.md's own verified-safe skeleton (`Architecture Patterns` section, lines 138-176 of `01-RESEARCH.md`), which already cites the exact SwiftLint source file (`SeverityLevelsConfiguration.swift`) confirming warning-only `file_length`/`type_body_length`/`function_body_length` works on 0.65.1.
- Concrete numbers already fixed for `file_length`: verified worst offenders are `MediaDetailView.swift` (1,443 lines) and `BookView.swift` (1,227 lines) — RESEARCH.md's recommended value is **1500**.
- `type_body_length`/`function_body_length` thresholds are NOT determinable from this repo scan (no Swift toolchain here) — RESEARCH.md flags this as a genuine Wave-0 macbuild task (run once with generous placeholders, read the real violation report, then lock final numbers). Do not invent numbers in the plan; make "run on macbuild with placeholders, then finalize" an explicit task.
- `included:` paths must be exactly the three source roots confirmed in this session: `Rawkoon`, `Sources`, `Tests` (matches `apps/ios/Rawkoon`, `apps/ios/Sources/RawkoonKit`, `apps/ios/Tests/RawkoonKitTests`).
- `disabled_rules`/`opt_in_rules` entries each need a `#`-comment reason directly above them (LINT-04) — no existing repo convention for "disable with reason" to borrow (Biome configs in sibling workspaces don't have a comparable pattern), so this is a fresh convention this file establishes; keep every reason comment terse and specific (see RESEARCH.md's `todo`/`unused_import` examples for the expected tone).
- Do **not** set `strict: true` (RESEARCH.md Pitfall 1 — would fail CI on the very first commit against ~150 unaudited default-warning rules).

---

### `apps/ios/.swiftformat` (config, no in-repo analog)

**No analog exists.** Anchor on the one hard cross-file constraint: `apps/ios/project.yml:69` — `SWIFT_VERSION: "5.0"` under `targets.Rawkoon.settings.base`. The `--swiftversion` flag in `.swiftformat` must match this exactly (`--swiftversion 5.0`), and a comment should note this ties to `project.yml` and must be bumped together in any later Swift-version-bump phase (RESEARCH.md already drafted this exact comment — copy verbatim).

Keep the file minimal per RESEARCH.md's explicit recommendation — default rule set only, no custom rule list — since the milestone's constraint is zero user-visible/behavioral change and a broad default autoformat pass is the intended first commit (LINT-01's criterion allows "no Swift source changed other than SwiftFormat's own output").

---

### `apps/ios/Rawkoon/Logging.swift` (new file)

**Analog for file shape/conventions (not content):** `apps/ios/Rawkoon/FileStore.swift` (full file, 62 lines, read above)

**Namespace convention to copy** (`FileStore.swift:1-3`):
```swift
import Foundation

enum FileStore {
    static func chapterURL(editionId: Int, fileId: Int, ext: String) -> URL {
```
`FileStore` establishes this codebase's convention for a stateless, static-only "namespace" type: `enum` (not `struct`, since there's no instance state and `enum` with no cases can't be instantiated — the compiler-enforced idiom this codebase already reaches for). `Logging.swift`'s `enum Log { ... }` matches this exactly — RESEARCH.md's own drafted code (lines 210-218 of `01-RESEARCH.md`) already follows this shape:
```swift
import os

enum Log {
    private static let subsystem = "cloud.samlo.rawkoon"

    static let playback = Logger(subsystem: subsystem, category: "playback")
    static let download = Logger(subsystem: subsystem, category: "download")
    static let network = Logger(subsystem: subsystem, category: "network")
    static let auth = Logger(subsystem: subsystem, category: "auth")
    static let sync = Logger(subsystem: subsystem, category: "sync")
}
```
No other file in `Rawkoon/` uses `os`/`OSLog`/`Logger` (confirmed zero hits by RESEARCH.md's grep) — this is genuinely new vocabulary, not a refactor of an existing pattern.

**Doc-comment convention to copy:** top-of-file explanatory comments in this codebase explain *why*, not *what* (per the audit's own observed strength, `code-quality-audit.md:39`: "Comments explain *why*, at the point of the surprise"). E.g. `ChapterDownloader.swift`'s inline comment on the `manifest` field ("Not `let`: an expired grant is replaced in place... because the session identifier has to stay stable...") is the house tone — `Logging.swift` should carry one such comment explaining the subsystem string choice and category boundaries, not a generic "logging setup" header.

---

### `apps/ios/Rawkoon/AudiobookPlayer.swift` (modify — 2 `try?` sites, lines 316, 887)

**Site 1 — line 316** (`AudiobookPlayer.swift:316`, inside session teardown):
```swift
try? AVAudioSession.sharedInstance().setActive(
    false,
    options: .notifyOthersOnDeactivation
)
```

**Site 2 — line 887** (inside an artwork-fetch `Task`):
```swift
artworkTask = Task { [weak self] in
    guard
        let (data, _) = try? await URLSession.shared.data(from: url),
        !Task.isCancelled,
        let image = UIImage(data: data)
    else { return }
    ...
}
```

**Analog for the conversion idiom:** `AppModel.swift:307-339` (`startDownload`) — this file has no existing `do/catch`, so the do/catch shape must be imported from `AppModel.swift`'s own established pattern:
```swift
func startDownload(editionId: Int) async {
    errorMessage = nil

    do {
        let manifest = try await manifest(editionId)
        ...
    } catch {
        errorMessage = message(for: error)
    }
}
```
Note the pattern: clear a transient error/state field before the block, `do { ... }`, `catch { errorMessage = message(for: error) }`. `AudiobookPlayer` has no `errorMessage`-equivalent published property — RESEARCH.md's own recommendation is to log rather than surface UI state for these two sites (session-deactivation failure and best-effort artwork fetch are not user-facing failures). Use `Log.playback.error(...)` in a `catch` block for site 1; site 2 (artwork fetch inside `guard let ... else { return }`) is harder to convert without restructuring control flow — RESEARCH.md's Open Questions §3 explicitly allows a justifying comment instead of a full do/catch conversion where mechanically awkward. Prefer minimal-diff: wrap only what's needed to log, don't restructure the guard chain if avoidable.

---

### `apps/ios/Rawkoon/ChapterDownloader.swift` (modify — 1 `try?` site, ~line 205)

**Analog: the file's own adjacent code**, 8 lines below the `try?` site:
```swift
if fileManager.fileExists(atPath: destination.path) {
    try? fileManager.removeItem(at: destination)
}

do {
    try fileManager.moveItem(at: location, to: destination)
} catch {
    applyEventAndContinue(.transportFailed(fileId: fileId), fileId: fileId)
    return
}
```
The `do/catch` idiom to copy is right there in the same function — `catch { applyEventAndContinue(...); return }` is this file's existing error-surfacing convention (feed the failure into the state machine via `applyEventAndContinue`, not a published error string). The `try?` cleanup line above it ("remove pre-existing destination file, best-effort") is the one RESEARCH.md scores as fine to leave as a commented `try?` (deleting a file that may not exist is not exceptional) — add a one-line comment rather than converting, per Open Questions §3's guidance.

**Non-2xx status log site** (RESEARCH.md's Code Examples, `~line 188` area, for LOG-03/criterion-4 verification target):
```swift
if !(200...299).contains(status) {
    Log.download.error(
        "Chapter download failed: editionId=\(self.editionId, privacy: .public) fileId=\(fileId, privacy: .public) status=\(status, privacy: .public)"
    )
    applyEventAndContinue(
        .completed(fileId: fileId, status: status, bytes: 0, sha256: nil),
        fileId: fileId
    )
    return
}
```
Deliberately never interpolate `ManifestChapter.url` (a signed, time-limited grant per this file's own comments — "A grant lasts seven days") — that is the credential-leak risk LOG-03 forbids.

---

### `apps/ios/Rawkoon/AppModel.swift` (modify — `refreshGrants`, 1 `try?` site)

**Analog:** the file's own `startDownload` (lines 307-339, quoted above) — same class, same `@MainActor`/`ObservableObject` context, already establishes `do { ... } catch { errorMessage = message(for: error) }`.

**Site to convert** (`AppModel.swift:483`, inside `refreshGrants`):
```swift
guard let refreshed = try? await manifest(editionId, forceRefresh: true) else { return }
downloaders[editionId]?.refreshChapterURLs(from: refreshed)
```
`refreshGrants` already has rich surrounding context (attempt counting, `errorMessage = "Downloads for this book need a fresh sign-in."` on the attempts-exhausted branch just above) — convert to:
```swift
do {
    let refreshed = try await manifest(editionId, forceRefresh: true)
    downloaders[editionId]?.refreshChapterURLs(from: refreshed)
} catch {
    Log.download.error("Grant refresh failed for edition \(editionId, privacy: .public): \(error, privacy: .public)")
}
```
This matches the file's own `startDownload` shape and adds a log line consistent with `download` category scoping (RESEARCH.md's Logger domain-to-file mapping table explicitly names `refreshGrants` under `download`).

**Confirmed no other download-orchestration `try?` sites exist:** `startDownload` (do/catch already), `deleteDownloads` (lines 428-441, no `try?`), `applyDownloadPlan` (lines 489-498, no `try?`) — nothing further to touch in this file for LOG-02.

---

### `apps/ios/docs/` new page (LOG-04)

**Analog:** `apps/ios/docs/code-quality-audit.md` (only existing file in the directory)

**Heading/front-matter convention to copy** (`code-quality-audit.md:1-4`):
```markdown
# iOS clean-code audit — 2026-09-01

Audit of `apps/ios` against current (2026) iOS/SwiftUI practice. Measured on
commit `602a6e0` (v1.12.6).
```
Pattern: `# <Title> — <date>` as H1, then a one-paragraph scope/context statement before any content, no YAML front-matter block. Sub-sections use `## Title Case` headings and short prose paragraphs, tables where data-dense (see the LOC table at line 8-13). The new doc (log retrieval commands, per RESEARCH.md's Code Examples) should open the same way: `# iOS log retrieval — 2026-09-01` (or similar), one paragraph of context (no remote log aggregation exists; this is manual by design), then command blocks in fenced ```bash sections exactly as drafted in RESEARCH.md lines 257-271. Also include the `OS_ACTIVITY_DT_MODE`/Xcode-debugger redaction-bypass caution (RESEARCH.md Common Pitfalls §2 and Security Domain table) as its own subsection — this is a security-relevant caveat, not just a command reference.

---

### `apps/ios/project.yml` — confirmed no edit needed

**Evidence** (`project.yml:14-18`):
```yaml
targets:
  Rawkoon:
    type: application
    platform: iOS
    sources: [Rawkoon]
```
`sources: [Rawkoon]` is a directory-level glob — XcodeGen picks up every `.swift` file under `apps/ios/Rawkoon/` automatically. `Logging.swift` dropped into that directory needs no `project.yml` change. The only build-setting-relevant line in this file for this phase is `SWIFT_VERSION: "5.0"` (line 69), which `.swiftformat`'s `--swiftversion` flag must mirror (see above) — this is a read/reference dependency, not an edit.

## Shared Patterns

### CI job style (workflow-wide)
**Source:** `.github/workflows/ios.yml` (whole file)
**Apply to:** the new `lint` job
- `checkout@v4` first step, always.
- Bare `- run:` for simple one-liners; `- name:` reserved for steps needing explanation.
- `working-directory: apps/ios` on every step touching the source tree.
- `brew install <formula...>`, no version pin, matching `build`'s `brew install xcodegen`.

### Error-surfacing convention (`AppModel.swift`/`ChapterDownloader.swift`)
**Source:** `AppModel.swift:307-339` (`startDownload`), `ChapterDownloader.swift` (`moveItem` do/catch)
**Apply to:** all four modified Swift files
Two established idioms depending on layer:
- `AppModel.swift` (UI-facing `ObservableObject`): `do { ... } catch { errorMessage = message(for: error) }` — surfaces to the view layer.
- `ChapterDownloader.swift` (background delegate, no UI binding): `do { ... } catch { applyEventAndContinue(...); return }` — feeds the download state machine.
- Neither file currently logs; LOG-01/02 adds `Log.<category>.error(...)` calls *inside* these existing catch blocks (or as a new catch block replacing a bare `try?`), it does not replace the existing state-management behavior — this is exactly the phase's "add a log line, don't change behavior" constraint (RESEARCH.md, `.claude/CLAUDE.md` Behavior constraint).

### Privacy-first logging (`os.Logger`)
**Source:** RESEARCH.md Code Examples (verified against Apple's `OSLogPrivacy` docs)
**Apply to:** every new `Log.*` call site
- Numeric types (`Int`, `Double`, `Bool`) are public-by-default even unannotated, but annotate explicitly anyway (`\(value, privacy: .public)`) for self-documentation against future type changes.
- Never interpolate `Authorization` header values, `chapter.url` (signed grant), or password parameters — grep the diff for `Bearer`/`token`/`.url,` inside any `Log.*` call as a verification step, per RESEARCH.md Pitfall 2.
- Verify redaction behavior via `xcrun simctl launch` (never Xcode's Run/Debug button, which disables redaction via `OS_ACTIVITY_DT_MODE`).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/ios/.swiftlint.yml` | config | batch | Repo has zero prior SwiftLint config anywhere (confirmed twice, by RESEARCH.md and this pass) — greenfield adoption; use RESEARCH.md's verified skeleton, not a repo analog |
| `apps/ios/.swiftformat` | config | batch | Same — zero prior SwiftFormat config; anchor only on `project.yml`'s `SWIFT_VERSION: "5.0"` |
| `apps/ios/Rawkoon/Logging.swift` (logging content, not file shape) | utility | event-driven | Zero existing `os.Logger`/`OSLog`/`print(` usage in `Rawkoon/` (confirmed by grep) — file-shape analog (`FileStore.swift`'s `enum` namespace) substituted; the `Logger(subsystem:category:)` content itself has no in-repo precedent |

## Metadata

**Analog search scope:** `.github/workflows/ios.yml`, `apps/ios/project.yml`, `apps/ios/docs/`, `apps/ios/Rawkoon/{AudiobookPlayer,ChapterDownloader,FileStore,AppModel,APIClient}.swift` — all read directly this session (some ranges carried over from RESEARCH.md's own verified reads, cross-checked rather than re-read where ranges would overlap).
**Files scanned:** 9 target files + `apps/ios/docs/code-quality-audit.md` as the docs analog.
**Pattern extraction date:** 2026-09-01
