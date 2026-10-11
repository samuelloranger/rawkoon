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
    var userInitials: String?
    var ssoProviders: [SsoProvider] = []
    var loading = false
    var errorMessage: String?
    /// Set when sign-in succeeded but the credential could not be written to the
    /// Keychain — the session works now but will not survive a relaunch. Surfaced
    /// as an alert at the app root, distinct from `errorMessage` (a login failure).
    var authWarning: String?
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
    /// A title a widget tap asked to open; Home pushes its detail and clears it.
    var pendingMediaLink: MediaLink?
    /// Shown by the app root: an alert attached to a screen pushed with the zoom
    /// transition stays hidden until the tab changes.
    var pendingConfirm: ConfirmRequest?
    /// The in-flight `/api/auth/me` fetch, so launch, Settings and a reconnect
    /// share one request.
    var profileTask: Task<Void, Never>?
    /// When the server last confirmed `library`; nil while it is only the saved
    /// copy painted at launch, so screens know to refresh it once.
    var libraryFetchedAt: Date?
    /// Bumped whenever the server is reachable again (network back, or the live
    /// stream reconnecting after a drop), so screens painted from saved data refetch.
    var reconnectToken = 0
    /// The in-flight library load — Home, Library and the root all ask for one on
    /// launch, and every page of the library should be fetched once.
    var libraryTask: Task<Void, Never>?

    let serverStateStore = ServerStateStore()

    // MARK: Live updates (spec §T2/T4)

    /// Owns the SSE consumers and the observable state they feed (change tokens,
    /// live download progress, stream statuses, debug log, unread count, banner).
    /// AppModel keeps its previous surface via AppModel+Notifications, so no view
    /// call site changes. Wired to `self` in `init`.
    let liveUpdates = LiveUpdatesCoordinator()

    /// Set from a banner tap or a notification-list row tap (via
    /// `navigate(toNotificationUrl:)`); `RawkoonApp` presents it as a sheet
    /// from the app root, so it works regardless of which tab is active.
    /// Bounded to the paths `NotificationDestination.resolve` understands —
    /// see spec T6.
    var deepLinkTarget: NotificationDestination?

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
    var pendingBackgroundCompletions: [String: () -> Void] = [:]
    var verifiedCounts: [Int: Int] = [:]
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

    let journalURL: URL
    /// Not `let`: before the first unlock the Keychain is unreadable, so the
    /// launch value can be provisional until protected data becomes available.
    private(set) var deviceID: String

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
            hydrateFromCache()
        }

        player.onPositionTick = { [weak self] in self?.persistPlaybackProgress(force: false) }
        player.onPlaybackStopped = { [weak self] in self?.persistPlaybackProgress(force: true) }
        player.refreshManifest = { [weak self] editionId in await self?.refreshedManifest(editionId: editionId) }
        player.isNetworkAvailable = { [weak self] in self?.isOnline ?? true }
        startPathMonitor()
        observeProtectedData()
        compactJournal()
        restoreDownloadedAudiobooks()
        refreshDownloadedBookIds()
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
                hydrateFromCache()
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

        switch style {
        case .success: RawkoonHaptics.play(.success)
        case .error: RawkoonHaptics.play(.error)
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

    /// The configured API client, or nil when logged out. Manage-lane screens
    /// call this directly (e.g. `try await model.api()?.explore()`).
    func api() -> APIClient? {
        apiClient
    }

    // MARK: Notification and download coordination state

    var pendingApnsToken: String?
    /// Retained after registration so sign-out can unregister it.
    var registeredApnsToken: String?
    /// Editions whose grants are being refetched, and how often — a server whose
    /// secret rotated would otherwise refetch forever.
    var grantRefreshAttempts: [Int: Int] = [:]
    var startingDownloads: Set<Int> = []
    var invalidatingSessions: Set<Int> = []
    var grantRefreshInFlight: Set<Int> = []

    var didRefreshAdminOnce = false

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
        deviceID = Self.resolveDeviceID()
        guard !isLoggedIn,
              let token = Keychain.get(Self.authTokenKey),
              let server = Keychain.get(Self.serverURLKey),
              let baseURL = URL(string: server)
        else { return }
        serverURL = server
        apiClient = makeAPIClient(baseURL: baseURL, token: token)
        isLoggedIn = true
        hydrateFromCache()
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

/// A library title to open from outside the app, such as a widget tap.
struct MediaLink: Hashable {
    let libraryId: Int
    let tmdbId: Int
    let mediaType: String
    let title: String

    init?(url: URL) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value
        }
        guard url.host == "media",
              let library = value("library").flatMap(Int.init),
              let tmdb = value("tmdb").flatMap(Int.init),
              let type = value("type"), type == "movie" || type == "tv"
        else { return nil }
        libraryId = library
        tmdbId = tmdb
        mediaType = type
        title = value("title") ?? ""
    }
}

struct ConfirmRequest: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let confirmTitle: String
    var isDestructive = true
    let action: @MainActor () -> Void
    /// Optional middle choice (e.g. "Choose a release") between confirm and cancel.
    var secondaryTitle: String?
    var secondaryAction: (@MainActor () -> Void)?
    /// Overrides the default "Cancel" label.
    var cancelTitle: String?
}

extension Notification.Name {
    static let audiobookDownloadStateChanged = Notification.Name("audiobookDownloadStateChanged")
}
