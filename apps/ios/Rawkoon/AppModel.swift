import Foundation
import Network
import Observation
import RawkoonKit
import UIKit
import UserNotifications

@MainActor
@Observable
final class AppModel {
    /// One instance for the process.
    ///
    /// A background launch to deliver `handleEventsForBackgroundURLSession` may
    /// never render a view, so the AppDelegate cannot wait for `onAppear` to be
    /// handed the model — by then the completion handler is long overdue and the
    /// finished downloads are discarded.
    static let shared = AppModel()

    var isLoggedIn = false
    var serverURL: String
    var library: [BookListItem] = []
    var isAdmin = false
    var userFirstName: String?
    var ssoProviders: [SsoProvider] = []
    var loading = false
    var errorMessage: String?
    /// Set when sign-in succeeded but the credential could not be written to the
    /// Keychain — the session works now but will not survive a relaunch. Surfaced
    /// as an alert at the app root, distinct from `errorMessage` (a login failure).
    var authWarning: String?
    var downloadPlans: [Int: DownloadPlan] = [:]
    /// Last known resume point per audiobook edition, so a button can read
    /// "Resume from …" before the player is opened. Filled by
    /// `loadResumePreview(editionId:totalDurationSecs:)`.
    var resumePreview: [Int: Double] = [:]
    /// The ebook equivalent: the stored reading position per edition, so a button
    /// can name the chapter before the reader is opened.
    var readingResumePreview: [Int: ReadingPosition] = [:]
    var activeEditionId: Int?
    /// True when `library` was built from the on-device downloaded index because
    /// the server was unreachable — the UI shows an "Offline" hint instead of a
    /// network-error wall, and lists only downloaded books.
    var isOfflineLibrary = false

    let serverStateStore = ServerStateStore()

    // MARK: Live updates (spec §T2/T4)

    /// Owns the SSE consumers and the observable state they feed (change tokens,
    /// live download progress, stream statuses, debug log, unread count, banner).
    /// AppModel keeps its previous surface via the passthroughs below, so no view
    /// call site changed. Wired to `self` in `init`.
    let liveUpdates = LiveUpdatesCoordinator()

    /// Set from a banner tap or a notification-list row tap (via
    /// `navigate(toNotificationUrl:)`); `RawkoonApp` presents it as a sheet
    /// from the app root, so it works regardless of which tab is active.
    /// Bounded to the paths `NotificationDestination.resolve` understands —
    /// see spec T6.
    var deepLinkTarget: NotificationDestination?

    /// Passthroughs to `liveUpdates`, preserving AppModel's prior public surface.
    /// All are read-only here; the coordinator owns every write.
    var libraryChangeToken: Int {
        liveUpdates.libraryChangeToken
    }

    var bookChangeToken: Int {
        liveUpdates.bookChangeToken
    }

    var notificationChangeToken: Int {
        liveUpdates.notificationChangeToken
    }

    var downloadProgress: [Int: [Int: LiveDownload]] {
        liveUpdates.downloadProgress
    }

    var unreadNotificationCount: Int {
        liveUpdates.unreadNotificationCount
    }

    var bannerNotification: StreamNotificationDTO? {
        liveUpdates.bannerNotification
    }

    var libraryStreamStatus: SSEStreamStatus {
        liveUpdates.libraryStreamStatus
    }

    var notificationStreamStatus: SSEStreamStatus {
        liveUpdates.notificationStreamStatus
    }

    var sseDebugLog: [SSEDebugLogEntry] {
        liveUpdates.sseDebugLog
    }

    /// Forces both SSE connections closed and immediately reopens them — see
    /// `LiveUpdatesCoordinator.forceReconnect`.
    func forceReconnectSSE() {
        liveUpdates.forceReconnect()
    }

    /// Current toast banner, rendered once at the app root by `ToastOverlay`.
    /// Any screen can call `toast(_:style:)` to surface a background action's
    /// result without owning any presentation state itself.
    var currentToast: Toast?
    private var toastDismissTask: Task<Void, Never>?

    let player = AudiobookPlayer()

    static let serverURLKey = "server_url"
    static let authTokenKey = "auth_token"
    private static let deviceIDKey = "device_id"

    static let persistFailedWarning = String(localized: "Signed in, but this device couldn't save your login. You may need to sign in again after quitting the app.")

    var apiClient: APIClient?
    var manifests: [Int: BookManifest] = [:]
    var downloaders: [Int: ChapterDownloader] = [:]
    private var pendingBackgroundCompletions: [String: () -> Void] = [:]
    var verifiedCounts: [Int: Int] = [:]
    var lastProgressWriteMillis: [Int: Int64] = [:]
    /// Whether the device currently has a usable network path.
    ///
    /// Starts `true` so a launch never assumes offline before the monitor has
    /// reported. It says an interface exists, not that the server answers — a
    /// captive portal or a down server still has to be handled by whatever
    /// waits on the request.
    private(set) var isOnline = true
    private let pathMonitor = NWPathMonitor()

    let readingProgressStore = ReadingProgressStore(
        directory: FileStore.booksDirectory()
    )
    var lastProgressPosition: [Int: Double] = [:]

    let journalURL: URL
    let deviceID: String

    init() {
        serverURL = Keychain.get(Self.serverURLKey) ?? ""
        journalURL = Self.positionLogURL()
        deviceID = Self.resolveDeviceID()
        liveUpdates.appModel = self

        if
            let token = Keychain.get(Self.authTokenKey),
            let baseURL = URL(string: serverURL)
        {
            apiClient = makeAPIClient(baseURL: baseURL, token: token)
            isLoggedIn = true
        }

        player.onPositionTick = { [weak self] in self?.persistPlaybackProgress(force: false) }
        player.onPlaybackStopped = { [weak self] in self?.persistPlaybackProgress(force: true) }
        startPathMonitor()
        restoreDownloadedAudiobooks()
    }

    /// Rehydrates in-memory manifests and download plans from disk so a process
    /// kill does not look like "Chapters couldn't load" / a missing download.
    private func restoreDownloadedAudiobooks() {
        var editionIds = Set(
            DownloadedStore.readIndex()
                .filter { $0.kind == .audiobook }
                .map(\.editionId)
        )
        let root = FileStore.booksDirectory()
        if let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) {
            for name in names {
                if let id = Int(name) {
                    editionIds.insert(id)
                }
            }
        }
        for editionId in editionIds {
            guard let manifest = DownloadedStore.readManifest(editionId: editionId) else {
                continue
            }
            manifests[editionId] = manifest
            let existingBytes = Self.onDiskBytes(editionId: editionId, files: manifest.files)
            // Only surface a plan when files are actually on disk. A manifest-only
            // cache (written at download-start) must not look like an in-flight
            // 0% download after a process kill — there is no live downloader.
            let plan = DownloadPlan.restored(
                files: manifest.files,
                existingBytes: existingBytes
            )
            if plan.isComplete {
                downloadPlans[editionId] = plan
            }
        }
    }

    private func startPathMonitor() {
        pathMonitor.pathUpdateHandler = { path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self else { return }
                let cameBackOnline = online && !isOnline
                isOnline = online
                // Reconnected: un-latch downloads the dead zone stranded.
                if cameBackOnline {
                    for downloader in downloaders.values {
                        downloader.retryFailedChapters()
                    }
                }
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "cloud.samlo.rawkoon.path"))
    }

    #if DEBUG
        /// Simulator/screenshot convenience: log in from launch environment when
        /// present. Compiled only in Debug, so it never ships in a Release/TestFlight
        /// build. Pass via `SIMCTL_CHILD_RAWKOON_SERVER` etc. to `simctl launch`.
        func debugAutologinIfNeeded() async {
            guard !isLoggedIn else { return }
            let env = ProcessInfo.processInfo.environment

            // A simulator build carries no keychain entitlement, so nothing the app
            // stores survives a relaunch and every launch starts logged out. Taking
            // a bearer token straight from the environment sidesteps the keychain
            // entirely, and avoids putting a real password on a command line.
            if
                let server = env["RAWKOON_SERVER"],
                let token = env["RAWKOON_TOKEN"],
                let baseURL = URL(string: server)
            {
                serverURL = server
                apiClient = makeAPIClient(baseURL: baseURL, token: token)
                isLoggedIn = true
                try? await reloadLibrary()
                return
            }

            guard
                let server = env["RAWKOON_SERVER"],
                let email = env["RAWKOON_EMAIL"],
                let password = env["RAWKOON_PASSWORD"]
            else { return }
            await login(server: server, email: email, password: password)
        }

        /// Simulator convenience: start an edition's chapter downloads straight from
        /// the launch environment, so the download path can be exercised without tap
        /// injection — the same reason `RAWKOON_SCREEN` exists. Pass via
        /// `SIMCTL_CHILD_RAWKOON_DOWNLOAD_EDITION=<id>` to `simctl launch`.
        ///
        /// This is how the log-redaction check is run: hide a chapter's file on the
        /// server so its grant verifies and the content route then 404s, launch with
        /// this variable set, and read the resulting `Log.download.error` line out of
        /// `simctl spawn booted log stream`. Compiled only in Debug, so it never ships.
        func debugStartDownloadIfRequested() async {
            guard
                isLoggedIn,
                let raw = ProcessInfo.processInfo.environment["RAWKOON_DOWNLOAD_EDITION"],
                let editionId = Int(raw)
            else { return }
            await startDownload(editionId: editionId)
        }
    #endif

    /// Surfaces a brief banner at the app root and auto-dismisses it. This is
    /// the app-wide fix for actions that used to fail (or succeed) silently:
    /// call this from anywhere instead of stashing an error string a screen
    /// might not be showing.
    func toast(_ message: String, style: Toast.Style = .info, action: ToastAction? = nil) {
        currentToast = Toast(message: message, style: style, action: action)

        let generator = UINotificationFeedbackGenerator()
        switch style {
        case .success: generator.notificationOccurred(.success)
        case .error: generator.notificationOccurred(.error)
        case .info: break
        }

        // An actionable toast (e.g. discover's "Undo") gets a longer window —
        // the user needs time to read it and decide, not just glance at it.
        let dismissDelay: Double = action == nil ? 3 : 5

        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(dismissDelay))
            guard !Task.isCancelled else { return }
            self?.currentToast = nil
        }
    }

    func loadLibrary() async {
        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            try await reloadLibrary()
        } catch {
            errorMessage = message(for: error)
        }
    }

    /// The configured API client, or nil when logged out. Manage-lane screens
    /// call this directly (e.g. `try await model.api()?.explore()`).
    func api() -> APIClient? {
        apiClient
    }

    // MARK: Live updates (spec §T2/T4)

    /// Starts the library-events and notification SSE consumers — see
    /// `LiveUpdatesCoordinator.start`. Call when the app becomes active while
    /// signed in (see `RawkoonApp`'s `scenePhase` handling).
    func startLiveStreams() {
        liveUpdates.start()
    }

    /// Stops both live streams. Call on background/logout.
    func stopLiveStreams() {
        liveUpdates.stop()
    }

    /// Dismisses the in-app notification banner early (e.g. on tap).
    func dismissBanner() {
        liveUpdates.dismissBanner()
    }

    /// Resolves a notification's `url` to a native destination and pushes it.
    func navigate(toNotificationUrl url: String?) {
        liveUpdates.navigate(toNotificationUrl: url)
    }

    /// Best-effort unread-count refresh — called after sign-in and whenever
    /// `NotificationsListView` changes read state server-side.
    func refreshUnreadNotificationCount() async {
        await liveUpdates.refreshUnreadCount()
    }

    // MARK: Push notifications (APNs)

    private var pendingApnsToken: String?
    /// Retained after registration so sign-out can unregister it.
    var registeredApnsToken: String?
    /// Editions whose grants are being refetched, and how often — a server whose
    /// secret rotated would otherwise refetch forever.
    private var grantRefreshAttempts: [Int: Int] = [:]
    private var grantRefreshInFlight: Set<Int> = []

    /// Ask for notification permission, then register for remote notifications.
    /// Safe to call repeatedly — the system won't re-prompt once decided.
    func requestPushAuthorization() {
        #if DEBUG
            // Skip the permission prompt when screenshotting an offline debug
            // screen — the dialog would cover the view under review.
            if let screen = DebugScreen.requested, DebugScreen.isOffline(screen) {
                return
            }
        #endif
        Task {
            let center = UNUserNotificationCenter.current()
            let granted = await (try? center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Called from the app delegate with the hex device token.
    func handleApnsToken(_ token: String) {
        pendingApnsToken = token
        Task { await registerApnsIfPossible() }
    }

    private func registerApnsIfPossible() async {
        guard let token = pendingApnsToken, let apiClient else { return }
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        try? await apiClient.registerApns(
            deviceToken: token,
            deviceName: UIDevice.current.name,
            osVersion: UIDevice.current.systemVersion,
            appVersion: appVersion,
            bundleId: Bundle.main.bundleIdentifier
        )
        registeredApnsToken = token
        pendingApnsToken = nil
    }

    /// The book currently loaded in the player, if any — drives the persistent
    /// mini-player and its expand-to-full-player sheet. Non-nil once
    /// `openPlayer(editionId:)` has run (it caches the manifest and sets
    /// `activeEditionId`).
    func activeBook() -> (summary: LibrarySummary, manifest: BookManifest)? {
        guard
            let id = activeEditionId,
            let summary = library.first(where: { $0.audiobookEditionId == id })?.audiobookSummary,
            let manifest = manifests[id]
        else {
            return nil
        }
        return (summary, manifest)
    }

    /// Loads the library if a CarPlay-only launch means no SwiftUI view ever
    /// triggered `loadLibrary()`.
    func ensureLibraryLoaded() async {
        if library.isEmpty {
            await loadLibrary()
        }
    }

    /// Flattens the audiobook library + remote progress into the Linux-tested
    /// CarPlay browse model. `libraryOrder` preserves the server's list order.
    func carPlayAudiobooks() async -> [CarPlayBrowseEntry] {
        let progressByEdition: [Int: RemoteProgress] = if let client = api(),
                                                          let progress = try? await client.getProgress()
        {
            Dictionary(
                progress.map { ($0.editionId, $0) }, uniquingKeysWith: { first, _ in first }
            )
        } else {
            [:]
        }

        var entries: [CarPlayBrowseEntry] = []
        for (index, book) in library.enumerated() {
            guard let summary = book.audiobookSummary else { continue }
            let progress = progressByEdition[summary.editionId]
            entries.append(
                CarPlayBrowseEntry(
                    editionId: summary.editionId,
                    title: summary.title,
                    author: summary.author,
                    positionSecs: progress.map { $0.finished ? 0 : $0.positionSecs },
                    totalDurationSecs: progress?.totalDurationSecs ?? summary.durationSecs,
                    updatedAtMillis: progress.map { Int64($0.updatedAt.timeIntervalSince1970 * 1000) },
                    libraryOrder: index
                )
            )
        }
        return entries
    }

    /// Resolves a possibly-relative image path against the server base URL.
    /// TMDB poster URLs are already absolute; library posters may be relative.
    func absoluteURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let absolute = URL(string: raw), absolute.scheme != nil {
            return absolute
        }
        guard let base = URL(string: serverURL) else { return nil }
        return URL(string: raw, relativeTo: base)?.absoluteURL
    }

    func cachedManifest(_ editionId: Int) -> BookManifest? {
        if let cached = manifests[editionId] {
            return cached
        }
        if let disk = DownloadedStore.readManifest(editionId: editionId) {
            manifests[editionId] = disk
            return disk
        }
        return nil
    }

    func manifest(_ editionId: Int, forceRefresh: Bool = false) async throws -> BookManifest {
        if !forceRefresh, let cached = manifests[editionId] {
            return cached
        }
        if !forceRefresh, let disk = DownloadedStore.readManifest(editionId: editionId) {
            manifests[editionId] = disk
            return disk
        }
        guard let apiClient else {
            // Logged out or no client: a downloaded book still opens from its
            // persisted manifest rather than failing.
            if let disk = DownloadedStore.readManifest(editionId: editionId) {
                manifests[editionId] = disk
                return disk
            }
            throw APIError.unauthorized
        }

        do {
            let fetched = try await apiClient.manifest(editionId: editionId)
            manifests[editionId] = fetched
            // Backfill a pre-existing, fully-downloaded audiobook (downloaded
            // before offline persistence shipped) the first time it is opened
            // online, so it too becomes usable offline.
            if !isIndexedAsDownloaded(editionId),
               !fetched.files.isEmpty,
               DownloadPlan.restored(
                   files: fetched.files,
                   existingBytes: Self.onDiskBytes(editionId: editionId, files: fetched.files)
               ).isComplete
            {
                persistDownloadedAudiobook(editionId: editionId)
            }
            return fetched
        } catch {
            // Offline / server unreachable: fall back to the downloaded copy so
            // playback works with no network. Re-throw only when nothing is
            // cached on disk.
            if let disk = DownloadedStore.readManifest(editionId: editionId) {
                manifests[editionId] = disk
                return disk
            }
            throw error
        }
    }

    func startDownload(editionId: Int) async {
        errorMessage = nil

        do {
            // Fresh grants: a restored disk manifest is enough to list chapters
            // but its signed URLs may already have expired.
            let manifest = try await manifest(editionId, forceRefresh: true)
            DownloadedStore.writeManifest(manifest, editionId: editionId)
            guard let baseURL = URL(string: serverURL) else {
                errorMessage = String(localized: "Enter a valid server URL.")
                return
            }
            if let existing = downloaders[editionId] {
                // Re-tap means "try again": fresh grants, given-up chapters cleared.
                grantRefreshAttempts.removeValue(forKey: editionId)
                existing.refreshChapterURLs(from: manifest)
                existing.retryFailedChapters()
                existing.start()
                return
            }

            let allowCellularDownloads = UserDefaults.standard.string(forKey: "download_over") != "wifi"
            let downloader = ChapterDownloader(
                editionId: editionId,
                baseURL: baseURL,
                manifest: manifest,
                allowCellular: allowCellularDownloads
            ) { [weak self] plan in
                Task { @MainActor in
                    self?.applyDownloadPlan(plan, editionId: editionId)
                }
            }
            if let pending = pendingBackgroundCompletions.first(where: { downloader.hasBackgroundSession(identifier: $0.key) }) {
                downloader.setBackgroundSessionCompletion(pending.value)
                pendingBackgroundCompletions.removeValue(forKey: pending.key)
            }

            downloaders[editionId] = downloader
            downloader.start()
        } catch {
            errorMessage = message(for: error)
        }
    }

    func openPlayer(editionId: Int, resumeAt overridePosition: Double? = nil) async {
        errorMessage = nil

        // Reloading the book already playing would pause it and rewind it to a
        // stale snapshot, so only an explicitly chosen position moves it.
        if editionId == activeEditionId, player.manifest?.editionId == editionId {
            if let overridePosition {
                player.seek(to: overridePosition)
            }
            return
        }

        do {
            let manifest = try await manifest(editionId)
            guard let baseURL = URL(string: serverURL) else {
                errorMessage = String(localized: "Enter a valid server URL.")
                return
            }

            let resumeAt: Double = if let overridePosition {
                max(0, min(overridePosition, manifest.totalDurationSecs))
            } else {
                await resolveResumePosition(editionId: editionId, manifest: manifest)
            }
            persistPlaybackProgress(force: true)
            activeEditionId = editionId
            player.load(
                manifest: manifest,
                baseURL: baseURL,
                resumeAt: resumeAt,
                artworkURL: library
                    .first(where: { $0.audiobookEditionId == editionId })?
                    .audiobookSummary?.coverURL
            )
        } catch {
            errorMessage = message(for: error)
        }
    }

    /// Closes the player: stops audio, drops Now Playing, hides the mini bar.
    func closePlayer() {
        persistPlaybackProgress(force: true)
        activeEditionId = nil
        player.unload()
    }

    func handleBackgroundEvents(identifier: String, completionHandler: @escaping () -> Void) {
        if let downloader = downloaders.values.first(where: { $0.hasBackgroundSession(identifier: identifier) }) {
            downloader.setBackgroundSessionCompletion(completionHandler)
            downloader.start()
            return
        }

        pendingBackgroundCompletions[identifier] = completionHandler

        // The `downloaders` map is in-memory, so after the app was terminated it
        // is empty and nothing is attached to the session. iOS delivers
        // `didFinishDownloadingTo` only to a delegate, and discards the
        // temporary file if none exists — so the downloader has to be rebuilt
        // here rather than waiting for the user to tap download again.
        // `startDownload` picks the pending completion up by identifier.
        guard let editionId = ChapterDownloader.editionId(fromSessionIdentifier: identifier) else {
            pendingBackgroundCompletions.removeValue(forKey: identifier)
            completionHandler()
            return
        }
        Task { await startDownload(editionId: editionId) }
    }

    func deleteDownloads() {
        let editionIDs = Set(library.compactMap(\.audiobookEditionId))
            .union(manifests.keys)
            .union(downloadPlans.keys)

        // Through purgeDownload so each live downloader goes too; a surviving one
        // re-reports its all-verified plan and re-lists the book with no files.
        for editionId in editionIDs {
            purgeDownload(editionId: editionId)
        }
    }

    /// Cancels an in-progress audiobook download and discards its partial
    /// files. One tap, no confirmation: nothing finished is lost, and the
    /// chapters re-fetch on the next Download tap.
    func cancelDownload(editionId: Int) {
        purgeDownload(editionId: editionId)
    }

    /// Removes a fully downloaded audiobook from the device. The UI confirms
    /// this because it throws away completed files.
    func removeDownload(editionId: Int) {
        purgeDownload(editionId: editionId)
    }

    /// Tears down any live downloader, deletes the edition's files, and clears
    /// its plan. A straggling task cannot re-create the directory because the
    /// downloader is cancelled before the files go.
    private func purgeDownload(editionId: Int) {
        downloaders[editionId]?.cancel()
        downloaders.removeValue(forKey: editionId)
        FileStore.deleteEdition(editionId)
        DownloadedStore.forget(editionId: editionId)
        downloadPlans.removeValue(forKey: editionId)
        verifiedCounts.removeValue(forKey: editionId)
        // The playing book keeps streaming, and progress saving needs its manifest.
        if activeEditionId != editionId {
            manifests.removeValue(forKey: editionId)
        }
        // Otherwise a stale attempt count could trip maxGrantRefreshAttempts on
        // the next download of this edition.
        grantRefreshAttempts.removeValue(forKey: editionId)
        grantRefreshInFlight.remove(editionId)
        if activeEditionId == editionId {
            player.rebuild()
        }
    }

    /// Replaces the downloader's signed URLs after a grant expired.
    ///
    /// The plan requeues a 401/403 chapter without spending an attempt, so
    /// without this the same dead URL is pumped forever. Capped, because a
    /// rotated server secret makes every refetch land on the same wall.
    private func refreshGrants(editionId: Int) async {
        guard !grantRefreshInFlight.contains(editionId) else { return }
        let attempts = grantRefreshAttempts[editionId] ?? 0
        guard attempts < Self.maxGrantRefreshAttempts else {
            errorMessage = String(localized: "Downloads for this book need a fresh sign-in.")
            return
        }
        grantRefreshInFlight.insert(editionId)
        grantRefreshAttempts[editionId] = attempts + 1
        defer { grantRefreshInFlight.remove(editionId) }

        do {
            // Straight to the API: manifest(forceRefresh:) falls back to the disk
            // copy, whose URLs are the expired ones being replaced.
            guard let apiClient else { throw APIError.unauthorized }
            let refreshed = try await apiClient.manifest(editionId: editionId)
            manifests[editionId] = refreshed
            downloaders[editionId]?.refreshChapterURLs(from: refreshed)
        } catch {
            Log.download.error(
                """
                Grant refresh failed: \
                editionId=\(editionId, privacy: .public) \
                error=\(error.localizedDescription, privacy: .public)
                """
            )
        }
    }

    private static let maxGrantRefreshAttempts = 3

    private func applyDownloadPlan(_ plan: DownloadPlan, editionId: Int) {
        // A late callback from a downloader that `purgeDownload` already dropped
        // (cancel/remove) must not resurrect the plan or the deleted files.
        guard downloaders[editionId] != nil else { return }
        if plan.needsFreshGrants {
            Task { await refreshGrants(editionId: editionId) }
        }

        let newCount = verifiedFileCount(in: plan)

        downloadPlans[editionId] = plan
        verifiedCounts[editionId] = newCount

        // When the last chapter verifies, persist what the offline library needs
        // to list and play this audiobook without the network. Guard on a
        // missing on-disk manifest so this runs once per completed download, not
        // on every state emission.
        if plan.isComplete, !isIndexedAsDownloaded(editionId) {
            persistDownloadedAudiobook(editionId: editionId)
        }
    }

    /// Size of each chapter already on disk, keyed by file id.
    private static func onDiskBytes(editionId: Int, files: [ManifestFile]) -> [Int: Int] {
        var existingBytes: [Int: Int] = [:]
        for file in files {
            let ext = file.fileExtension
            guard FileStore.exists(editionId: editionId, fileId: file.id, ext: ext) else { continue }
            let url = FileStore.chapterURL(editionId: editionId, fileId: file.id, ext: ext)
            if let bytes = FileStore.size(url: url) {
                existingBytes[file.id] = bytes
            }
        }
        return existingBytes
    }

    /// The index, not manifest.json, marks a finished download: the manifest is
    /// written when a download starts.
    private func isIndexedAsDownloaded(_ editionId: Int) -> Bool {
        DownloadedStore.readIndex().contains { $0.editionId == editionId && $0.kind == .audiobook }
    }

    /// Recovers chapters whose completion never arrived; see `ChapterDownloader.resync`.
    func resyncDownloads() {
        for downloader in downloaders.values {
            downloader.resync()
        }
    }

    /// Snapshots a freshly-completed audiobook into the offline store — see
    /// `OfflineLibraryStore.persistAudiobook`. Reads the manifest and book this
    /// model already holds and hands them off.
    private func persistDownloadedAudiobook(editionId: Int) {
        guard let manifest = manifests[editionId] else { return }
        let book = library.first { $0.audiobookEditionId == editionId }
        OfflineLibraryStore.persistAudiobook(editionId: editionId, manifest: manifest, book: book)
    }

    /// Records a downloaded ebook into the offline store — see
    /// `OfflineLibraryStore.recordEbookDownloaded`. Called by the Book screen
    /// after a file finishes downloading; `editionId` is the storage id the
    /// on-disk file uses.
    func recordEbookDownloaded(
        editionId: Int,
        bookId: Int,
        title: String,
        author: String?,
        coverURL: URL?,
        files: [BookEditionFile],
        downloadedFileCount: Int
    ) {
        OfflineLibraryStore.recordEbookDownloaded(
            editionId: editionId, bookId: bookId, title: title, author: author,
            coverURL: coverURL, files: files, downloadedFileCount: downloadedFileCount
        )
    }

    /// The persisted ebook file list for a downloaded edition, or nil — see
    /// `OfflineLibraryStore.ebookFiles`. The Book screen falls back to this when
    /// the server is unreachable.
    func offlineEbookFiles(editionId: Int) -> [BookEditionFile]? {
        OfflineLibraryStore.ebookFiles(editionId: editionId)
    }

    func reloadLibrary() async throws {
        guard let apiClient else { throw APIError.unauthorized }
        do {
            let fetched = try await apiClient.libraryBooks()
            library = fetched.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            isOfflineLibrary = false
            await refreshAdmin()
        } catch {
            // Offline / server unreachable: serve the downloaded index so the
            // library shows what can actually be used without the network.
            // Only when nothing is downloaded do we surface the error.
            let downloaded = DownloadedStore.readIndex()
            guard !downloaded.isEmpty else { throw error }
            library = Self.offlineLibrary(from: downloaded)
            isOfflineLibrary = true
        }
    }

    /// Collapses the downloaded index into library rows, merging an audiobook
    /// and an ebook of the same book into one row (mirroring the online merged
    /// list) and preserving the title sort.
    private static func offlineLibrary(from index: [DownloadedEdition]) -> [BookListItem] {
        var byBook: [Int: [DownloadedEdition]] = [:]
        for entry in DownloadedLibrary.sortedForDisplay(index) {
            byBook[entry.bookId, default: []].append(entry)
        }
        // Order books by their best (first, per the title sort) edition.
        var seen = Set<Int>()
        var order: [Int] = []
        for entry in DownloadedLibrary.sortedForDisplay(index) where !seen.contains(entry.bookId) {
            seen.insert(entry.bookId)
            order.append(entry.bookId)
        }
        return order.compactMap { bookId in
            guard let editions = byBook[bookId], let primary = editions.first else { return nil }
            let audiobook = editions.first { $0.kind == .audiobook }
            let ebook = editions.first { $0.kind == .ebook }
            return BookListItem(
                bookId: bookId,
                title: primary.title,
                author: primary.author,
                coverURL: DownloadedStore.coverURL(
                    editionId: primary.editionId, fileName: primary.coverFileName
                ),
                audiobookEditionId: audiobook?.editionId,
                ebookEditionId: ebook?.editionId,
                audiobookDurationSecs: audiobook?.totalDurationSecs,
                audiobookStatus: audiobook != nil ? "downloaded" : nil,
                audiobookFileCount: audiobook?.fileCount ?? 0,
                hasEbook: ebook != nil,
                readAt: nil
            )
        }
    }

    var didRefreshAdminOnce = false

    /// Mark the whole book read (or clear the badge). Marking read wipes this
    /// user's ebook and audiobook progress on the server and this device.
    func setBookRead(_ book: BookListItem, read: Bool) async {
        guard let apiClient else { return }
        errorMessage = nil
        do {
            try await apiClient.setBookRead(bookId: book.bookId, read: read)
            if read {
                clearLocalProgress(for: book)
            }
            await loadLibrary()
            liveUpdates.bumpBookChangeToken()
            toast(
                read
                    ? String(localized: "Marked as read.")
                    : String(localized: "Read badge cleared."),
                style: .success
            )
        } catch {
            toast(message(for: error), style: .error)
        }
    }

    private func clearLocalProgress(for book: BookListItem) {
        let editionIds = [book.audiobookEditionId, book.ebookEditionId].compactMap(\.self)
        for editionId in editionIds {
            try? readingProgressStore.remove(editionId: editionId)
            lastProgressPosition[editionId] = nil
        }
        let kept = PositionJournal.excluding(readJournal(), editionIds: Set(editionIds))
        try? kept.write(to: journalURL, atomically: true, encoding: .utf8)
        if let active = activeEditionId, editionIds.contains(active) {
            player.seek(to: 0)
        }
    }

    private func verifiedFileCount(in plan: DownloadPlan) -> Int {
        plan.files.reduce(into: 0) { count, file in
            if plan.states[file.id] == .verified {
                count += 1
            }
        }
    }

    func message(for error: Error) -> String {
        guard let apiError = error as? APIError else {
            return String(localized: "Unexpected error. Please try again.")
        }
        return apiError.userMessage()
    }

    private static func resolveDeviceID() -> String {
        if let existing = Keychain.get(deviceIDKey), !existing.isEmpty {
            return existing
        }
        let newValue = UUID().uuidString
        Keychain.set(newValue, for: deviceIDKey)
        return newValue
    }

    private static func positionLogURL() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var url = root.appendingPathComponent("positions.log", isDirectory: false)
        FileStore.excludeFromBackup(&url)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        return url
    }

    static func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
