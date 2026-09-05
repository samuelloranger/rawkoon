import Foundation
import Network
import Observation
import RawkoonKit
import UIKit
import UserNotifications

/// Runs `operation`, giving up and returning nil after `seconds`.
///
/// The losing child is cancelled, but a URLSession call already in flight keeps
/// running to its own timeout in the background; the point is only that the
/// caller stops waiting on it.
private func withDeadline<T: Sendable>(
    seconds: Double,
    _ operation: @escaping @Sendable () async -> T?
) async -> T? {
    await withTaskGroup(of: T?.self) { group in
        group.addTask { await operation() }
        group.addTask {
            try? await Task.sleep(for: .seconds(seconds))
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

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
    var activeEditionId: Int?
    /// True when `library` was built from the on-device downloaded index because
    /// the server was unreachable — the UI shows an "Offline" hint instead of a
    /// network-error wall, and lists only downloaded books.
    var isOfflineLibrary = false

    // MARK: Live updates (spec §T2/T4)

    /// Bumped whenever a `.media` event arrives on the foreground-only
    /// `/api/library/events` SSE stream. There is no TanStack Query
    /// equivalent on iOS, so "invalidate" means "a view watching this token
    /// via `.onChange` reloads itself" — see `LibraryView`, `MediaDetailView`,
    /// `ActivityView`.
    private(set) var libraryChangeToken = 0
    /// Same idea as `libraryChangeToken`, for `.book` events — see
    /// `LibraryView`, `BookView`, `ActivityView`.
    private(set) var bookChangeToken = 0
    /// Bumped for each notification arriving on the stream, so an open
    /// `NotificationsListView` refetches (via `.task(id:)`) rather than only
    /// the bell badge updating while the list stays stale.
    private(set) var notificationChangeToken = 0

    /// Kept live by the notification stream and by `NotificationsListView`'s
    /// own REST calls; drives the Home bell badge.
    var unreadNotificationCount = 0
    /// The most recent live notification, shown as a transient top banner and
    /// cleared after a few seconds — the iOS analog of the web app's
    /// `NotificationToastContainer`. `id` lets `NotificationBannerView` key its
    /// dismiss timer per-notification instead of restarting on unrelated
    /// re-renders.
    var bannerNotification: StreamNotificationDTO?
    /// Set from a banner tap or a notification-list row tap (via
    /// `navigate(toNotificationUrl:)`); `RawkoonApp` presents it as a sheet
    /// from the app root, so it works regardless of which tab is active.
    /// Bounded to the paths `NotificationDestination.resolve` understands —
    /// see spec T6.
    var deepLinkTarget: NotificationDestination?

    private var libraryEventsTask: Task<Void, Never>?
    private var notificationStreamTask: Task<Void, Never>?
    private var bannerDismissTask: Task<Void, Never>?

    /// Current toast banner, rendered once at the app root by `ToastOverlay`.
    /// Any screen can call `toast(_:style:)` to surface a background action's
    /// result without owning any presentation state itself.
    var currentToast: Toast?
    private var toastDismissTask: Task<Void, Never>?

    let player = AudiobookPlayer()

    private static let serverURLKey = "server_url"
    private static let authTokenKey = "auth_token"
    private static let deviceIDKey = "device_id"

    private static let persistFailedWarning = String(localized: "Signed in, but this device couldn't save your login. You may need to sign in again after quitting the app.")

    private var apiClient: APIClient?
    private var manifests: [Int: BookManifest] = [:]
    private var downloaders: [Int: ChapterDownloader] = [:]
    private var pendingBackgroundCompletions: [String: () -> Void] = [:]
    private var verifiedCounts: [Int: Int] = [:]
    private var lastProgressWriteMillis: [Int: Int64] = [:]
    /// Whether the device currently has a usable network path.
    ///
    /// Starts `true` so a launch never assumes offline before the monitor has
    /// reported. It says an interface exists, not that the server answers — a
    /// captive portal or a down server still has to be handled by whatever
    /// waits on the request.
    private(set) var isOnline = true
    private let pathMonitor = NWPathMonitor()

    private let readingProgressStore = ReadingProgressStore(
        directory: FileStore.booksDirectory()
    )
    private var lastProgressPosition: [Int: Double] = [:]

    private let journalURL: URL
    private let deviceID: String

    init() {
        serverURL = Keychain.get(Self.serverURLKey) ?? ""
        journalURL = Self.positionLogURL()
        deviceID = Self.resolveDeviceID()

        if
            let token = Keychain.get(Self.authTokenKey),
            let baseURL = URL(string: serverURL)
        {
            apiClient = APIClient(baseURL: baseURL, token: token)
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
            var existingBytes: [Int: Int] = [:]
            for chapter in manifest.chapters {
                let ext = chapter.fileExtension
                guard FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: ext) else {
                    continue
                }
                let url = FileStore.chapterURL(editionId: editionId, fileId: chapter.fileId, ext: ext)
                if let bytes = FileStore.size(url: url) {
                    existingBytes[chapter.fileId] = bytes
                }
            }
            // Only surface a plan when files are actually on disk. A manifest-only
            // cache (written at download-start) must not look like an in-flight
            // 0% download after a process kill — there is no live downloader.
            let plan = DownloadPlan.restored(
                chapters: manifest.chapters,
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

    func login(server: String, email: String, password: String) async {
        let normalizedServer = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let baseURL = URL(string: normalizedServer) else {
            errorMessage = String(localized: "Enter a valid server URL.")
            return
        }

        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            let client = APIClient(baseURL: baseURL, token: nil)
            let token = try await client.login(email: email, password: password)

            let serverSaved = Keychain.set(normalizedServer, for: Self.serverURLKey)
            let tokenSaved = Keychain.set(token, for: Self.authTokenKey)
            if !serverSaved || !tokenSaved {
                authWarning = Self.persistFailedWarning
            }

            serverURL = normalizedServer
            apiClient = client
            isLoggedIn = true
            try await reloadLibrary()
            requestPushAuthorization()
            startLiveStreams()
            await refreshUnreadNotificationCount()
        } catch {
            errorMessage = message(for: error)
        }
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
                apiClient = APIClient(baseURL: baseURL, token: token)
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
    func toast(_ message: String, style: Toast.Style = .info) {
        currentToast = Toast(message: message, style: style)

        let generator = UINotificationFeedbackGenerator()
        switch style {
        case .success: generator.notificationOccurred(.success)
        case .error: generator.notificationOccurred(.error)
        case .info: break
        }

        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            self?.currentToast = nil
        }
    }

    /// Load the enabled OAuth providers for the login screen (public endpoint).
    func loadSsoProviders() async {
        let raw = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, let base = URL(string: raw) else { ssoProviders = []; return }
        let client = apiClient ?? APIClient(baseURL: base, token: nil)
        ssoProviders = await (try? client.ssoProviders().providers) ?? []
    }

    /// Sign in through a provider using the native browser OAuth flow.
    func signInWithProvider(_ slug: String) async {
        let raw = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let base = URL(string: raw),
            let startURL = URL(string: "/api/mobile/oauth-start?provider=\(slug)", relativeTo: base)?.absoluteURL
        else {
            errorMessage = String(localized: "Enter a valid server URL.")
            return
        }
        errorMessage = nil
        guard let callback = await WebAuthCoordinator.shared.start(url: startURL, scheme: "rawkoon") else {
            return // cancelled
        }
        let comps = URLComponents(url: callback, resolvingAgainstBaseURL: false)
        if let token = comps?.queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            await applyOAuthToken(server: raw, token: token)
        } else {
            errorMessage = String(localized: "Sign-in failed. Please try again.")
        }
    }

    private func applyOAuthToken(server: String, token: String) async {
        guard let base = URL(string: server) else {
            errorMessage = String(localized: "Enter a valid server URL.")
            return
        }
        let serverSaved = Keychain.set(server, for: Self.serverURLKey)
        let tokenSaved = Keychain.set(token, for: Self.authTokenKey)
        if !serverSaved || !tokenSaved {
            authWarning = Self.persistFailedWarning
        }
        serverURL = server
        apiClient = APIClient(baseURL: base, token: token)
        isLoggedIn = true
        do { try await reloadLibrary() } catch { errorMessage = message(for: error) }
        requestPushAuthorization()
        startLiveStreams()
        await refreshUnreadNotificationCount()
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

    /// Starts the library-events and notification SSE consumers if they
    /// aren't already running. Call when the app becomes active while signed
    /// in (see `RawkoonApp`'s `scenePhase` handling); a no-op when logged out
    /// or already running.
    func startLiveStreams() {
        guard isLoggedIn else { return }
        if libraryEventsTask == nil {
            libraryEventsTask = Task { [weak self] in
                await self?.runLibraryEventsLoop()
                // The loop also returns on its own (a 401, or the client going
                // away) — not just on cancellation. Clear the handle on those
                // natural exits so the next `.active` can start a fresh stream;
                // skip it when cancelled, since `stopLiveStreams` already nil'd
                // the handle and a restart may have replaced this task.
                guard let self, !Task.isCancelled else { return }
                libraryEventsTask = nil
            }
        }
        if notificationStreamTask == nil {
            notificationStreamTask = Task { [weak self] in
                await self?.runNotificationStreamLoop()
                guard let self, !Task.isCancelled else { return }
                notificationStreamTask = nil
            }
        }
    }

    /// Stops both live streams. Call on background/logout — APNs already
    /// covers background delivery, so a foreground-only stream has nothing
    /// left to do off-screen.
    func stopLiveStreams() {
        libraryEventsTask?.cancel()
        libraryEventsTask = nil
        notificationStreamTask?.cancel()
        notificationStreamTask = nil
    }

    /// Consumes `/api/library/events` until cancelled or unauthorized,
    /// reconnecting with exponential backoff (capped at 30s) on any other
    /// drop — the connection is expected to close periodically (idle
    /// timeouts, backgrounding at the edge, server restarts).
    private func runLibraryEventsLoop() async {
        var backoff = 1.0
        while !Task.isCancelled {
            guard let client = apiClient else { return }
            do {
                for try await event in await client.libraryEventsStream() {
                    backoff = 1.0
                    switch event {
                    case .media: libraryChangeToken += 1
                    case .book: bookChangeToken += 1
                    }
                }
            } catch APIError.unauthorized {
                Log.sync.notice("library events stream unauthorized — not reconnecting")
                return
            } catch {
                Log.sync.debug("library events stream dropped: \(error.localizedDescription, privacy: .public)")
            }
            if Task.isCancelled {
                return
            }
            try? await Task.sleep(for: .seconds(backoff))
            backoff = min(backoff * 2, 30)
        }
    }

    /// Consumes `/api/notifications/stream` the same way — see
    /// `runLibraryEventsLoop`. Each event bumps the unread count and shows the
    /// transient in-app banner; it does not itself update the notification
    /// list (open `NotificationsListView` refetches on appear/pull-to-refresh).
    private func runNotificationStreamLoop() async {
        var backoff = 1.0
        while !Task.isCancelled {
            guard let client = apiClient else { return }
            do {
                for try await notification in await client.notificationStream() {
                    backoff = 1.0
                    unreadNotificationCount += 1
                    notificationChangeToken += 1
                    showBanner(notification)
                }
            } catch APIError.unauthorized {
                Log.sync.notice("notification stream unauthorized — not reconnecting")
                return
            } catch {
                Log.sync.debug("notification stream dropped: \(error.localizedDescription, privacy: .public)")
            }
            if Task.isCancelled {
                return
            }
            try? await Task.sleep(for: .seconds(backoff))
            backoff = min(backoff * 2, 30)
        }
    }

    /// Shows the transient in-app banner for a live notification, replacing
    /// whichever one is already shown, and auto-dismisses it a few seconds
    /// later — the iOS analog of the web app's `NotificationToastContainer`.
    private func showBanner(_ notification: StreamNotificationDTO) {
        bannerDismissTask?.cancel()
        bannerNotification = notification
        bannerDismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            self?.dismissBanner()
        }
    }

    /// Dismisses the in-app banner early (e.g. on tap).
    func dismissBanner() {
        bannerDismissTask?.cancel()
        bannerDismissTask = nil
        bannerNotification = nil
    }

    /// Resolves a notification's `url` to a native destination and pushes it.
    /// Does nothing when the URL doesn't map to a screen (spec T6) — staying
    /// on the current screen is the safe fallback, not a web view or a crash.
    func navigate(toNotificationUrl url: String?) {
        guard let destination = NotificationDestination.resolve(url: url) else { return }
        deepLinkTarget = destination
    }

    /// Best-effort unread-count refresh — called after sign-in and whenever
    /// `NotificationsListView` changes read state server-side.
    func refreshUnreadNotificationCount() async {
        guard let client = apiClient else { return }
        if let response = try? await client.unreadNotificationCount() {
            unreadNotificationCount = response.unreadCount
        }
    }

    // MARK: Push notifications (APNs)

    private var pendingApnsToken: String?
    /// Retained after registration so sign-out can unregister it.
    private var registeredApnsToken: String?
    /// Editions whose grants are being refetched, and how often — a server whose
    /// secret rotated would otherwise refetch forever.
    private var grantRefreshAttempts: [Int: Int] = [:]
    private var grantRefreshInFlight: Set<Int> = []

    /// Ask for notification permission, then register for remote notifications.
    /// Safe to call repeatedly — the system won't re-prompt once decided.
    func requestPushAuthorization() {
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
            if DownloadedStore.readManifest(editionId: editionId) == nil,
               !fetched.chapters.isEmpty,
               DownloadedStore.downloadedFileCount(editionId: editionId) >= fetched.chapters.count
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
                // Re-tap means "try again": clear given-up chapters first.
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

        do {
            let manifest = try await manifest(editionId)
            guard let baseURL = URL(string: serverURL) else {
                errorMessage = String(localized: "Enter a valid server URL.")
                return
            }
            activeEditionId = editionId

            let resumeAt: Double = if let overridePosition {
                max(0, min(overridePosition, manifest.totalDurationSecs))
            } else {
                await resolveResumePosition(editionId: editionId, manifest: manifest)
            }
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
        player.unload()
        activeEditionId = nil
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

    func logout() {
        // Before apiClient is torn down: an APNs token identifies the phone, not
        // the account, so leaving it registered would deliver this user's
        // notifications to whoever signs in next.
        if let token = registeredApnsToken, let client = apiClient {
            Task { try? await client.unregisterApns(deviceToken: token) }
        }
        registeredApnsToken = nil

        stopLiveStreams()
        dismissBanner()
        deepLinkTarget = nil
        unreadNotificationCount = 0

        Keychain.delete(Self.serverURLKey)
        Keychain.delete(Self.authTokenKey)

        apiClient = nil
        isLoggedIn = false
        isAdmin = false
        library = []
        manifests = [:]
        downloaders = [:]
        downloadPlans = [:]
        verifiedCounts = [:]
        activeEditionId = nil
        player.pause()
        errorMessage = nil
    }

    func deleteDownloads() {
        let editionIDs = Set(library.compactMap(\.audiobookEditionId))
            .union(manifests.keys)
            .union(downloadPlans.keys)

        for editionId in editionIDs {
            FileStore.deleteEdition(editionId)
            DownloadedStore.forget(editionId: editionId)
        }

        downloadPlans = [:]
        verifiedCounts = [:]
        if activeEditionId != nil {
            player.rebuild()
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
        manifests.removeValue(forKey: editionId)
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
            let refreshed = try await manifest(editionId, forceRefresh: true)
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

        let newCount = verifiedChapterCount(in: plan)

        downloadPlans[editionId] = plan
        verifiedCounts[editionId] = newCount

        // When the last chapter verifies, persist what the offline library needs
        // to list and play this audiobook without the network. Guard on a
        // missing on-disk manifest so this runs once per completed download, not
        // on every state emission.
        if plan.isComplete, DownloadedStore.readManifest(editionId: editionId) == nil {
            persistDownloadedAudiobook(editionId: editionId)
        }
    }

    /// Snapshots a freshly-completed audiobook into the offline store: its
    /// manifest, a cached cover (best-effort), and an index record.
    private func persistDownloadedAudiobook(editionId: Int) {
        guard let manifest = manifests[editionId] else { return }
        let book = library.first { $0.audiobookEditionId == editionId }

        DownloadedStore.writeManifest(manifest, editionId: editionId)

        let entry = DownloadedEdition(
            editionId: editionId,
            bookId: manifest.bookId,
            kind: .audiobook,
            title: book?.title ?? manifest.title,
            author: book?.author ?? manifest.authors.first,
            totalDurationSecs: manifest.totalDurationSecs,
            fileCount: manifest.chapters.count,
            coverFileName: nil,
            addedAtMillis: Int64(Date().timeIntervalSince1970 * 1000)
        )
        DownloadedStore.upsert(entry)

        if let coverURL = book?.coverURL {
            Task { await cacheCover(from: coverURL, editionId: editionId) }
        }
    }

    /// Records a downloaded ebook into the offline store: its file list (so the
    /// Book screen can offer Read offline), an index record, and a cached cover.
    /// Called by the Book screen after a file finishes downloading; `editionId`
    /// is the storage id the on-disk file uses.
    func recordEbookDownloaded(
        editionId: Int,
        bookId: Int,
        title: String,
        author: String?,
        coverURL: URL?,
        files: [BookEditionFile],
        downloadedFileCount: Int
    ) {
        DownloadedStore.writeEbookFiles(files, editionId: editionId)
        let entry = DownloadedEdition(
            editionId: editionId,
            bookId: bookId,
            kind: .ebook,
            title: title,
            author: author,
            totalDurationSecs: nil,
            fileCount: max(downloadedFileCount, 1),
            coverFileName: nil,
            addedAtMillis: Int64(Date().timeIntervalSince1970 * 1000)
        )
        DownloadedStore.upsert(entry)
        if let coverURL {
            Task { await cacheCover(from: coverURL, editionId: editionId) }
        }
    }

    /// The persisted ebook file list for a downloaded edition, or nil. The Book
    /// screen falls back to this when the server is unreachable.
    func offlineEbookFiles(editionId: Int) -> [BookEditionFile]? {
        DownloadedStore.readEbookFiles(editionId: editionId)
    }

    /// Best-effort cover download for the offline list. Failure is silent — the
    /// row renders without art.
    private func cacheCover(from url: URL, editionId: Int) async {
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return }
        let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
        guard let fileName = DownloadedStore.writeCover(data, editionId: editionId, ext: ext) else { return }
        // Re-read/patch the index so the record points at the saved cover.
        let patched = DownloadedStore.readIndex().map { entry -> DownloadedEdition in
            guard entry.editionId == editionId else { return entry }
            return DownloadedEdition(
                editionId: entry.editionId, bookId: entry.bookId, kind: entry.kind,
                title: entry.title, author: entry.author,
                totalDurationSecs: entry.totalDurationSecs, fileCount: entry.fileCount,
                coverFileName: fileName, addedAtMillis: entry.addedAtMillis
            )
        }
        for entry in patched where entry.editionId == editionId {
            DownloadedStore.upsert(entry)
        }
    }

    private func resolveResumePosition(editionId: Int, manifest: BookManifest) async -> Double {
        let localEntry = PositionJournal.latest(in: readJournal(), editionId: editionId)
        let localRecord = localEntry.map {
            ProgressRecord(
                positionSecs: $0.positionSecs,
                totalDurationSecs: manifest.totalDurationSecs,
                finished: $0.positionSecs >= manifest.totalDurationSecs,
                updatedAtMillis: $0.atMillis
            )
        }

        var remoteRecord: ProgressRecord?
        if let apiClient,
           let remote = await (try? apiClient.getProgress())?.first(where: { $0.editionId == editionId })
        {
            remoteRecord = ProgressRecord(
                positionSecs: remote.positionSecs,
                totalDurationSecs: remote.totalDurationSecs,
                finished: remote.finished,
                updatedAtMillis: Int64(remote.updatedAt.timeIntervalSince1970 * 1000)
            )
        }

        switch SyncReconciler.reconcile(local: localRecord, remote: remoteRecord) {
        case .keepLocal:
            return localRecord?.positionSecs ?? 0
        case .takeRemote:
            guard let remoteRecord else { return localRecord?.positionSecs ?? 0 }
            let adjusted = SyncReconciler.adjust(remoteRecord, toTotal: manifest.totalDurationSecs)
            let entry = PositionEntry(
                editionId: editionId,
                positionSecs: adjusted.positionSecs,
                atMillis: adjusted.updatedAtMillis
            )
            appendJournal(entry)
            return adjusted.positionSecs
        case .push:
            guard let localRecord else { return 0 }
            sendProgress(
                editionId: editionId,
                positionSecs: localRecord.positionSecs,
                totalDurationSecs: manifest.totalDurationSecs,
                updatedAtMillis: localRecord.updatedAtMillis
            )
            return localRecord.positionSecs
        }
    }

    private func persistPlaybackProgress(force: Bool) {
        guard let editionId = activeEditionId, let manifest = manifests[editionId] else {
            return
        }

        let nowMillis = Self.nowMillis()
        if !force {
            let elapsed = nowMillis - (lastProgressWriteMillis[editionId] ?? 0)
            if elapsed < 5000 {
                return
            }
            if let last = lastProgressPosition[editionId], abs(last - player.positionSecs) < 1 {
                return
            }
        }

        let timeline = BookTimeline(chapters: manifest.chapters)
        let clamped = timeline.clamp(player.positionSecs)
        let entry = PositionEntry(editionId: editionId, positionSecs: clamped, atMillis: nowMillis)
        appendJournal(entry)

        lastProgressWriteMillis[editionId] = nowMillis
        lastProgressPosition[editionId] = clamped

        sendProgress(
            editionId: editionId,
            positionSecs: clamped,
            totalDurationSecs: manifest.totalDurationSecs,
            updatedAtMillis: nowMillis
        )
    }

    // MARK: Reading progress (ebooks)

    /// Where to open an ebook edition, reconciled across this device and the
    /// server. Same last-write-wins rule as the audiobook position. The caller
    /// prefers `winner.locator` when it parses; otherwise it runs
    /// `ReadingProgressReconciler.resolve` against the publication spine.
    func readingPosition(editionId: Int) async -> ReadingPosition? {
        let local = readingProgressStore.position(editionId: editionId)
        var remote: ReadingPosition?
        // Two separate reasons this must not block the reader.
        //
        // With no network path at all the request cannot succeed, so it is not
        // even attempted. But a path monitor reports "satisfied" whenever an
        // interface exists, and for a self-hosted server the common case is
        // having internet while the server itself is unreachable — away from
        // home, a captive portal, the box rebooting. There the request runs into
        // URLSession's full 60-second timeout, and the reader sat on
        // "Opening book…" that whole time for a book already on disk. So it is
        // also given a short deadline, after which the local position wins.
        if isOnline, let apiClient {
            remote = await withDeadline(seconds: 5) {
                await (try? apiClient.readingProgress())?
                    .first { $0.editionId == editionId }
            }
        }

        let winner: ReadingPosition?
        switch ReadingProgressReconciler.reconcile(local: local, remote: remote) {
        case .takeRemote:
            winner = remote
            // Mirror it locally so the next open resumes offline too.
            if let remote {
                try? readingProgressStore.save(remote)
            }
        case .keepLocal, .push:
            winner = local
        }
        return winner
    }

    /// Persists locally first, then pushes. The local write is what makes the
    /// position survive a crash or an offline session; the push is best-effort.
    func saveReadingPosition(_ position: ReadingPosition) {
        try? readingProgressStore.save(position)
        guard let apiClient else { return }
        Task { try? await apiClient.putReadingProgress(position, deviceId: deviceID) }
    }

    private func sendProgress(
        editionId: Int,
        positionSecs: Double,
        totalDurationSecs: Double,
        updatedAtMillis: Int64
    ) {
        guard let apiClient else { return }
        let finished = positionSecs >= max(totalDurationSecs - 1, 0)
        let updatedAt = Date(timeIntervalSince1970: Double(updatedAtMillis) / 1000)

        Task {
            try? await apiClient.putProgress(
                editionId: editionId,
                positionSecs: positionSecs,
                totalDurationSecs: totalDurationSecs,
                finished: finished,
                updatedAt: updatedAt,
                deviceId: deviceID
            )
        }
    }

    private func reloadLibrary() async throws {
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
                hasEbook: ebook != nil
            )
        }
    }

    private var didRefreshAdminOnce = false

    /// Refresh admin state on a cold Settings open (or after a promotion/demotion),
    /// since `refreshAdmin()` otherwise only runs on login/library-reload (spec §4.5).
    /// Only ever *adds* admin rows for real admins.
    func refreshAdminIfNeeded() async {
        guard apiClient != nil, !didRefreshAdminOnce else { return }
        didRefreshAdminOnce = true
        await refreshAdmin()
    }

    /// Best-effort: learn whether the signed-in user is an admin, so the UI can
    /// offer "Add to library" (admin) vs "Request" (non-admin).
    private func refreshAdmin() async {
        guard let apiClient else { return }
        if let user = await (try? apiClient.currentUser())?.user {
            isAdmin = user.isAdmin ?? false
            let full = [user.firstName, user.lastName].compactMap(\.self).joined(separator: " ")
            userFirstName = user.firstName ?? (full.isEmpty ? user.name : full)
        }
    }

    private func readJournal() -> String {
        (try? String(contentsOf: journalURL, encoding: .utf8)) ?? ""
    }

    private func appendJournal(_ entry: PositionEntry) {
        let line = PositionJournal.encode(entry)
        guard !line.isEmpty, let data = line.data(using: .utf8) else {
            return
        }

        if !FileManager.default.fileExists(atPath: journalURL.path) {
            FileManager.default.createFile(atPath: journalURL.path, contents: nil)
        }

        guard let handle = try? FileHandle(forWritingTo: journalURL) else {
            return
        }

        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.close()
        } catch {
            try? handle.close()
        }
    }

    private func verifiedChapterCount(in plan: DownloadPlan) -> Int {
        plan.chapters.reduce(into: 0) { count, chapter in
            if plan.states[chapter.fileId] == .verified {
                count += 1
            }
        }
    }

    private func message(for error: Error) -> String {
        guard let apiError = error as? APIError else {
            return String(localized: "Unexpected error. Please try again.")
        }
        switch apiError {
        case .unauthorized:
            return String(localized: "Unauthorized. Check your credentials.")
        case let .http(status):
            return String(localized: "Server error (\(status)).")
        case .decode:
            return String(localized: "Could not parse server response.")
        case .transport:
            return String(localized: "Network error. Check your connection.")
        }
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

    private static func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
