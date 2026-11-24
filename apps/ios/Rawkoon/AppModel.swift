import Foundation
import Network
import Observation
import RawkoonKit
import UIKit

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

    /// Bumped whenever the server is reachable again (network back, or the live
    /// stream reconnecting after a drop), so screens painted from saved data refetch.
    var reconnectToken = 0

    /// Toast and navigation/presentation requests; see `UIRouter`.
    let router = UIRouter()

    let serverStateStore = ServerStateStore()

    /// Credentials, API client, profile and server feature switches; see `SessionStore`.
    let session: SessionStore

    /// The book library, its load dedup and the growth card; see `LibraryStore`.
    let libraryStore: LibraryStore

    /// Audiobook downloads, manifests and the offline prefetch; see `DownloadsStore`.
    let downloads: DownloadsStore

    /// Playback and reading positions, the position journal and the audiobook/ebook handoff; see `ProgressStore`.
    let progress: ProgressStore

    // MARK: Live updates (spec §T2/T4)

    /// Owns the SSE consumers and the observable state they feed (change tokens,
    /// live download progress, stream statuses, debug log, unread count, banner).
    /// AppModel keeps its previous surface via AppModel+Notifications, so no view
    /// call site changes. Wired to `self` in `init`.
    let liveUpdates = LiveUpdatesCoordinator()

    /// The one live toast per added or searched title; see `AppModel+LiveSearch`.
    let liveSearch = LiveSearchCoordinator()

    let player = AudiobookPlayer()

    /// Whether the device currently has a usable network path.
    ///
    /// Starts `true` so a launch never assumes offline before the monitor has
    /// reported. It says an interface exists, not that the server answers — a
    /// captive portal or a down server still has to be handled by whatever
    /// waits on the request.
    private(set) var isOnline = true
    /// Cellular, a personal hotspot, or Low Data Mode: background prefetching waits.
    private(set) var isOnExpensiveNetwork = false
    private let pathMonitor = NWPathMonitor()

    init() {
        session = SessionStore(serverStateStore: serverStateStore)
        libraryStore = LibraryStore(session: session)
        downloads = DownloadsStore(session: session, libraryStore: libraryStore, router: router)
        progress = ProgressStore(
            session: session, libraryStore: libraryStore, downloads: downloads, router: router, player: player
        )
        liveUpdates.appModel = self
        liveSearch.appModel = self
        wireSession()
        wireLibrary()
        wireDownloads()
        wireProgress()

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

        player.onPositionTick = { [weak self] in self?.progress.persistPlaybackProgress(force: false) }
        player.onPlaybackStopped = { [weak self] in self?.progress.persistPlaybackProgress(force: true) }
        player.refreshManifest = { [weak self] editionId in
            await self?.downloads.refreshedManifest(editionId: editionId)
        }
        player.isNetworkAvailable = { [weak self] in self?.isOnline ?? true }
        startPathMonitor()
        observeProtectedData()
        restoreServerScope()
        progress.compactJournal()
        downloads.restoreDownloadedAudiobooks()
        downloads.refreshDownloadedBookIds()
    }

    /// Hands the store the follow-ups that span other domains, so it holds no back-reference to the model.
    private func wireSession() {
        session.onSessionExpired = { [weak self] in self?.handleSessionExpired() }
        session.reloadAfterSignIn = { [weak self] in try await self?.libraryStore.reloadLibrary() }
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

    private func wireLibrary() {
        libraryStore.prefetchForOffline = { [weak self] in await self?.downloads.prefetchForOffline() }
    }

    /// Hands the store the network path and the playing edition, which stay with the model and player.
    private func wireDownloads() {
        downloads.isOnline = { [weak self] in self?.isOnline ?? true }
        downloads.isOnExpensiveNetwork = { [weak self] in self?.isOnExpensiveNetwork ?? false }
        downloads.activeEditionId = { [weak self] in self?.progress.activeEditionId }
        downloads.rebuildPlayer = { [weak self] in self?.player.rebuild() }
    }

    /// Hands the store the network path and the player-opening flow, which spans downloads and the player.
    private func wireProgress() {
        progress.isOnline = { [weak self] in self?.isOnline ?? true }
        progress.openPlayer = { [weak self] editionId, resumeAt in
            await self?.openPlayer(editionId: editionId, resumeAt: resumeAt)
        }
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
                try? await libraryStore.reloadLibrary()
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
            await downloads.startDownload(editionId: editionId)
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
        downloads.restoreDownloadedAudiobooks()
        downloads.refreshDownloadedBookIds()
        hydrateFromCache()
    }
}

extension Notification.Name {
    static let audiobookDownloadStateChanged = Notification.Name("audiobookDownloadStateChanged")
}
