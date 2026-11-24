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

    var library: [BookListItem] = []
    var libraryGrowth: LibraryGrowth?
    var libraryGrowthFetchedAt: Date?
    /// True once a fetch failed with nothing cached, so the Library strip hides instead of waiting.
    var libraryGrowthFailed = false
    var downloadPlans: [Int: DownloadPlan] = [:]
    /// Books with any fully downloaded edition (audiobook or ebook), mirrored
    /// from the on-disk index so the book list order can react to it.
    private(set) var downloadedBookIds: Set<Int> = []
    /// Last known resume point per audiobook edition, so a button can read
    /// "Resume from …" before the player is opened. Filled by
    /// `loadResumePreview(editionId:totalDurationSecs:)`.
    var resumePreview: [Int: Double] = [:]
    /// The ebook equivalent: the stored reading position per edition, so a button
    /// can name the chapter before the reader is opened.
    var readingResumePreview: [Int: ReadingPosition] = [:]
    var activeEditionId: Int?
    /// True when `library` was built from the on-device downloaded index because
    /// the server was unreachable and no saved copy of the full library existed —
    /// the UI shows an "Offline" hint instead of a network-error wall, and lists
    /// only downloaded books.
    var isOfflineLibrary = false
    /// When the server last confirmed `library`; nil while it is only the saved
    /// copy painted at launch, so screens know to refresh it once.
    var libraryFetchedAt: Date?
    /// Bumped whenever the server is reachable again (network back, or the live
    /// stream reconnecting after a drop), so screens painted from saved data refetch.
    var reconnectToken = 0
    /// The in-flight library load — Home, Library and the root all ask for one on
    /// launch, and every page of the library should be fetched once.
    var libraryTask: Task<Void, Never>?

    /// Toast and navigation/presentation requests; see `UIRouter`.
    let router = UIRouter()

    let serverStateStore = ServerStateStore()

    /// Credentials, API client, profile and server feature switches; see `SessionStore`.
    let session: SessionStore

    // MARK: Live updates (spec §T2/T4)

    /// Owns the SSE consumers and the observable state they feed (change tokens,
    /// live download progress, stream statuses, debug log, unread count, banner).
    /// AppModel keeps its previous surface via AppModel+Notifications, so no view
    /// call site changes. Wired to `self` in `init`.
    let liveUpdates = LiveUpdatesCoordinator()

    /// The one live toast per added or searched title; see `AppModel+LiveSearch`.
    let liveSearch = LiveSearchCoordinator()
    /// Open requests awaiting an admin, for the Activity badge; zero for everyone else.
    var pendingRequestCount = 0

    let player = AudiobookPlayer()

    var manifests: [Int: BookManifest] = [:]
    var downloaders: [Int: ChapterDownloader] = [:]
    var pendingBackgroundCompletions: [String: () -> Void] = [:]
    var verifiedCounts: [Int: Int] = [:]
    /// The server key in force when each edition's download started; the index entry is stamped with it.
    var downloadServerKeys: [Int: String] = [:]
    /// Live in-flight chapter fractions per edition, for the chapter pills and the overall bar.
    var chapterFractions: [Int: [Int: Double]] = [:]
    /// Smooth, never-decreasing overall fraction per edition while it downloads.
    var downloadFractions: [Int: Double] = [:]
    var lastProgressWriteMillis: [Int: Int64] = [:]
    /// Whether the device currently has a usable network path.
    ///
    /// Starts `true` so a launch never assumes offline before the monitor has
    /// reported. It says an interface exists, not that the server answers — a
    /// captive portal or a down server still has to be handled by whatever
    /// waits on the request.
    private(set) var isOnline = true
    /// Cellular, a personal hotspot, or Low Data Mode: background prefetching waits.
    private(set) var isOnExpensiveNetwork = false
    var prefetchTask: Task<Void, Never>?
    private let pathMonitor = NWPathMonitor()

    let readingProgressStore = ReadingProgressStore(
        directory: FileStore.booksDirectory()
    )
    var lastProgressPosition: [Int: Double] = [:]
    /// Automatic handoff matches already answered or running, so reopening a book
    /// without moving does not transcribe again. In memory: a launch may recheck.
    var handoffMemo = HandoffSuggestion.Memo()
    /// Per book, when its audiobook and ebook positions last agreed through a handoff.
    var handoffAgreedAtMillis: [Int: Int64] = [:]

    let journalURL: URL

    init() {
        session = SessionStore(serverStateStore: serverStateStore)
        journalURL = Self.positionLogURL()
        liveUpdates.appModel = self
        liveSearch.appModel = self
        wireSession()

        if
            let token = Keychain.get(SessionStore.authTokenKey),
            let baseURL = URL(string: session.serverURL)
        {
            session.apiClient = session.makeAPIClient(baseURL: baseURL, token: token)
            session.isLoggedIn = true
            hydrateFromCache()
        }
        #if DEBUG
            // A simulator has no keychain; signing in before the first frame matches a signed-in device launch.
            let env = ProcessInfo.processInfo.environment
            if
                !session.isLoggedIn,
                let server = env["RAWKOON_SERVER"],
                let token = env["RAWKOON_TOKEN"],
                let baseURL = URL(string: server)
            {
                session.serverURL = server
                session.apiClient = session.makeAPIClient(baseURL: baseURL, token: token)
                session.isLoggedIn = true
                hydrateFromCache()
            }
        #endif

        player.onPositionTick = { [weak self] in self?.persistPlaybackProgress(force: false) }
        player.onPlaybackStopped = { [weak self] in self?.persistPlaybackProgress(force: true) }
        player.refreshManifest = { [weak self] editionId in await self?.refreshedManifest(editionId: editionId) }
        player.isNetworkAvailable = { [weak self] in self?.isOnline ?? true }
        startPathMonitor()
        observeProtectedData()
        restoreServerScope()
        compactJournal()
        restoreDownloadedAudiobooks()
        refreshDownloadedBookIds()
    }

    /// Hands the store the follow-ups that span other domains, so it holds no back-reference to the model.
    private func wireSession() {
        session.onSessionExpired = { [weak self] in self?.handleSessionExpired() }
        session.reloadAfterSignIn = { [weak self] in try await self?.reloadLibrary() }
        session.startAfterSignIn = { [weak self] in
            guard let self else { return }
            registerForPushIfAuthorized()
            startLiveStreams()
            ReencodeActivityCoordinator.shared.start(model: self)
            await refreshUnreadNotificationCount()
        }
        session.didIdentifyUser = { [weak self] id in self?.updateServerScope(userId: id) }
        session.describeError = { [weak self] error in self?.message(for: error) ?? error.localizedDescription }
    }

    func refreshDownloadedBookIds() {
        downloadedBookIds = Set(DownloadedStore.readIndex().map(\.bookId))
    }

    private func startPathMonitor() {
        #if DEBUG
            // The simulator shares the Mac's network, so offline screenshots need a switch.
            if ProcessInfo.processInfo.environment["RAWKOON_FORCE_OFFLINE"] == "1" {
                isOnline = false
                return
            }
        #endif
        pathMonitor.pathUpdateHandler = { path in
            let online = path.status == .satisfied
            let expensive = path.isExpensive || path.isConstrained
            Task { @MainActor [weak self] in
                guard let self else { return }
                let cameBackOnline = online && !isOnline
                isOnline = online
                isOnExpensiveNetwork = expensive
                // Reconnected: un-latch stranded downloads, refresh what the
                // offline launch painted from disk, and resend offline progress.
                if cameBackOnline {
                    handleReconnect()
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
            let env = ProcessInfo.processInfo.environment
            // `init` already signed in from RAWKOON_TOKEN; the library still needs its first load.
            if isLoggedIn, env["RAWKOON_TOKEN"] != nil {
                try? await reloadLibrary()
                return
            }
            guard !isLoggedIn else { return }

            guard
                let server = env["RAWKOON_SERVER"],
                let email = env["RAWKOON_EMAIL"],
                let password = env["RAWKOON_PASSWORD"]
            else { return }
            await session.login(server: server, email: email, password: password)
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

    /// Forwards to `UIRouter.toast`; kept because every screen calls it.
    @discardableResult
    func toast(
        _ message: String,
        style: Toast.Style = .info,
        action: ToastAction? = nil,
        duration: TimeInterval? = nil,
        showsProgress: Bool = false,
        replacing id: UUID? = nil
    ) -> UUID {
        router.toast(
            message, style: style, action: action, duration: duration,
            showsProgress: showsProgress, replacing: id
        )
    }

    /// The configured API client, or nil when logged out. Manage-lane screens
    /// call this directly (e.g. `try await model.api()?.explore()`).
    func api() -> APIClient? {
        session.apiClient
    }

    /// Read-only forwards to `SessionStore`; screens ask these hundreds of times.
    var isLoggedIn: Bool {
        session.isLoggedIn
    }

    var isAdmin: Bool {
        session.isAdmin
    }

    /// Forwards to `SessionStore.absoluteURL`.
    func absoluteURL(_ raw: String?) -> URL? {
        session.absoluteURL(raw)
    }

    // MARK: Notification and download coordination state

    /// Editions whose grants are being refetched, and how often — a server whose
    /// secret rotated would otherwise refetch forever.
    var grantRefreshAttempts: [Int: Int] = [:]
    var startingDownloads: Set<Int> = []
    var invalidatingSessions: Set<Int> = []
    var grantRefreshInFlight: Set<Int> = []

    func message(for error: Error) -> String {
        guard let apiError = error as? APIError else {
            return String(localized: "Unexpected error. Please try again.")
        }
        return apiError.userMessage()
    }

    /// A launch before the first unlock since boot (a background URLSession or
    /// CarPlay event) cannot read the Keychain, and would otherwise stay logged
    /// out for the life of the process.
    private func observeProtectedData() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.protectedDataDidBecomeAvailableNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.reloadCredentialsAfterUnlock() }
        }
    }

    private func reloadCredentialsAfterUnlock() {
        session.refreshDeviceID()
        guard !isLoggedIn,
              let token = Keychain.get(SessionStore.authTokenKey),
              let server = Keychain.get(SessionStore.serverURLKey),
              let baseURL = URL(string: server)
        else { return }
        session.activate(server: server, baseURL: baseURL, token: token)
        restoreServerScope()
        restoreDownloadedAudiobooks()
        refreshDownloadedBookIds()
        hydrateFromCache()
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

extension Notification.Name {
    static let audiobookDownloadStateChanged = Notification.Name("audiobookDownloadStateChanged")
}
