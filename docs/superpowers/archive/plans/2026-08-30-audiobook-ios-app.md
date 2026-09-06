> Shipped in #48.

# Audiobook iOS App — Phase 3 Vertical Slice

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A working iPhone app that logs into rawkoon, lists audiobooks, downloads one for offline, and plays it — built on RawkoonKit, compiled by CI, shipped to TestFlight.

**Architecture:** RawkoonKit (pure, done) + thin Apple-framework adapters + SwiftUI. Adapters cannot be
unit-tested on Linux, so they stay thin and the logic stays in RawkoonKit; CI compiles on macos-26 and
the operator tests via TestFlight. Download resilience comes from small per-chapter units + relaunch
reconciliation (DownloadPlan), NOT from background wake.

**Tech Stack:** Swift 6.3 / SwiftUI, AVFoundation, URLSession background config, better-auth bearer.
**Spec:** docs/superpowers/specs/2026-08-29-audiobook-player-design.md

## Global Constraints
- Swift 5 language mode (matches SWIFT_VERSION 5.0). iPhone-only, portrait.
- RawkoonKit stays Foundation-only; new Apple-framework code lives in the app target, not RawkoonKit.
- Auth: POST {server}/api/auth/sign-in/email {email,password}; bearer() returns the token in the
  `set-auth-token` response header. Store token + server URL in Keychain. Send `Authorization: Bearer <token>`
  on `/api/books/editions/:id/manifest`, `/api/books/progress`, PUT `/api/books/editions/:id/progress`.
  The content URL from the manifest is already signed — fetch it with NO auth header.
- Chapter files download to Application Support/Books/<editionId>/<fileId>.<ext>, excluded from iCloud backup.
- Verify each downloaded chapter by byte size (sha256 when the manifest provides it; it is null in phase 1).
- Do not add Co-Authored-By trailers. Commit locally; the operator pushes/dispatches.

## File Structure (all under apps/ios/Rawkoon/, the app target — NOT RawkoonKit)
| File | Responsibility |
|---|---|
| `Keychain.swift` | tiny Keychain get/set/delete for server URL + token |
| `APIClient.swift` | login, fetch manifest, get/put progress; Bearer header; Codable via RawkoonKit models |
| `FileStore.swift` | on-disk paths, backup exclusion, existence/size checks, delete |
| `ChapterDownloader.swift` | URLSession background session; drives DownloadPlan; writes+verifies files |
| `AudiobookPlayer.swift` | AVMutableComposition over downloaded files (+ empty ranges), AVPlayer, rate, NowPlaying |
| `AppModel.swift` | ObservableObject: auth state, library, per-edition download+play state |
| `Views/LoginView.swift`, `LibraryView.swift`, `BookView.swift`, `PlayerView.swift`, `SettingsView.swift` | screens |
| `RawkoonApp.swift` | replace the probe UI with the real root |

---

### Task 1: Keychain + APIClient (login, manifest, progress)
**Files:** Create `Rawkoon/Keychain.swift`, `Rawkoon/APIClient.swift`. Modify `project.yml` to add RawkoonKit as a target dependency of the app.

**Interfaces (Produces):**
- `enum Keychain { static func set(_ v: String, for key: String); static func get(_ key: String) -> String?; static func delete(_ key: String) }`
- `actor APIClient` with `init(baseURL: URL, token: String?)`, `func login(email: String, password: String) async throws -> String` (returns token), `func manifest(editionId: Int) async throws -> BookManifest`, `func libraryEditions() async throws -> [LibrarySummary]`, `func getProgress() async throws -> [RemoteProgress]`, `func putProgress(editionId: Int, positionSecs: Double, totalDurationSecs: Double, finished: Bool, updatedAt: Date) async throws`
- `struct LibrarySummary: Codable { let editionId: Int; let bookId: Int; let title: String; let author: String?; let kind: String; let coverUrl: String? }` — map from GET /api/books (audiobook editions only)

- [ ] Step 1: Keychain.swift — standard SecItem wrapper, service "cloud.samlo.rawkoon", `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (matches bivouac's SessionStore).
- [ ] Step 2: APIClient.swift — `login` POSTs sign-in/email, reads the `set-auth-token` header (fallback: JSON `token`), returns it. Other calls set `Authorization: Bearer`. Decode with `.convertFromSnakeCase` into RawkoonKit's `BookManifest`. On 401 throw `APIError.unauthorized`.
- [ ] Step 3: For the library list, GET `/api/books` and keep entries that have an audiobook edition; expose editionId + title + author + coverUrl. (Inspect the real shape at apps/api/src/routes/books/bookListRoutes.ts first and match it.)
- [ ] Step 4: `xcodegen generate` locally is not possible on Linux; instead confirm project.yml parses (`python3 -c "import yaml,sys; yaml.safe_load(open('apps/ios/project.yml'))"`). Commit.

### Task 2: FileStore + ChapterDownloader
**Files:** Create `Rawkoon/FileStore.swift`, `Rawkoon/ChapterDownloader.swift`.
**Interfaces (Produces):**
- `enum FileStore` — `func chapterURL(editionId: Int, fileId: Int, ext: String) -> URL`, `func exists(...) -> Bool`, `func size(...) -> Int?`, `func delete(editionId:)`, `func excludeFromBackup(_ url: URL)`; base is Application Support/Books.
- `final class ChapterDownloader: NSObject, URLSessionDownloadDelegate` — `init(editionId:, manifest:, fileStore:, onState: @escaping (DownloadPlan) -> Void)`, `func start()`, `func requestRetry(fileId:)`, reconciles `getAllTasks()` on init. Uses one background URLSession id `cloud.samlo.rawkoon.dl.<editionId>`. On each completion: check HTTPURLResponse.status, then size vs manifest, move file into FileStore, feed `DownloadPlan.apply(.completed(...))`, persist plan state, call onState. On failure feed `.transportFailed`. Verified files that already exist are marked `.verified` at init (reconciliation).

- [ ] Step 1: FileStore.swift with backup exclusion via `URLResourceValues.isExcludedFromBackup`.
- [ ] Step 2: ChapterDownloader.swift driving DownloadPlan; taskDescription = "editionId/fileId" so relaunch reconciliation works. Do NOT trust a 2xx alone — check status then bytes (this is the CORS/401-body lesson).
- [ ] Step 3: project.yml parses; commit.

### Task 3: AudiobookPlayer
**Files:** Create `Rawkoon/AudiobookPlayer.swift`.
**Interfaces (Produces):**
- `final class AudiobookPlayer: ObservableObject` — `func load(manifest:, fileStore:, resumeAt: Double)`, `@Published var positionSecs`, `isPlaying`, `currentChapterIndex`; `play()`, `pause()`, `seek(to:)`, `skip(±)`, `setRate(_)`, `nextChapter()`, `prevChapter()`. Builds ONE AVMutableComposition inserting each downloaded chapter file's asset in order and `insertEmptyTimeRange` for any not-yet-downloaded chapter, so currentTime is always whole-book. Uses RawkoonKit `BookTimeline` for chapter<->position. `AVAudioSession` `.playback`/`.spokenAudio`, activate on play. `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` (play/pause/skip/changePlaybackPosition). Rate via `AVPlayer.rate` + `audioTimePitchAlgorithm=.spectral`, no AVAudioEngine.
- [ ] Step 1: composition build + timeline mapping via BookTimeline (domain indices).
- [ ] Step 2: audio session, NowPlaying, remote commands.
- [ ] Step 3: rebuild composition when new chapters land (keep position). project.yml parses; commit.

### Task 4: AppModel + SwiftUI screens + wire root
**Files:** Create `Rawkoon/AppModel.swift`, `Rawkoon/Views/{LoginView,LibraryView,BookView,PlayerView,SettingsView}.swift`; modify `RawkoonApp.swift` (remove probe UI, use RootView driven by AppModel).
- [ ] Step 1: AppModel ties APIClient + ChapterDownloader + AudiobookPlayer + PositionJournal + SyncReconciler; on launch, if Keychain has server+token show Library else Login.
- [ ] Step 2: LoginView (server URL + email + password → APIClient.login → store token). LibraryView (list audiobooks, cover, "downloaded/•" badge). BookView (chapters, one Download button showing DownloadPlan.progressFraction, Play). PlayerView (cover, whole-book scrubber, ⏮/⏯/⏭, ±30s, rate, chapter title). SettingsView (server, log out, delete downloads, download-over: Any/WiFi default Any per operator).
- [ ] Step 3: RawkoonApp uses RootView; keep UIBackgroundModes audio. Journal position on every timeupdate + on scenePhase background. project.yml parses; commit.

### Task 5: Ship to TestFlight
- [ ] Step 1: operator pushes the branch and runs `gh workflow run ios.yml -f version=0.2.0`.
- [ ] Step 2: assign the new build to the "Internal" beta group (API: POST /v1/betaGroups/<id>/relationships/builds). Operator tests the real login→download→play loop.

## Self-Review
Covers spec's Adapters + iOS UI (screens 1–4,7 of the earlier map). Deferred: data-saver variant (phase 5), server-side splitter (phase 4), search/request (screen 5), APNs activity (screen 6). Background wake is best-effort, not required — download works foreground and resumes on relaunch.
