import Foundation
import Observation
import RawkoonKit
import UserNotifications

/// Owns the two foreground-only SSE consumers (`/api/library/events` and
/// `/api/notifications/stream`) and the observable state they feed: the change
/// tokens views watch, live download progress, stream statuses, the debug log,
/// the unread count, and the transient in-app banner.
///
/// Split out of `AppModel` so that class stays under the file_length lint
/// threshold and the live-update machinery is isolated. It reaches back to
/// `AppModel` (weak) only for the shared collaborators it does not own — the
/// API client, the server-state store, the login state, and session expiry.
/// `AppModel` keeps its previous public surface via passthroughs, so no view
/// call site changed.
@MainActor
@Observable
final class LiveUpdatesCoordinator {
    weak var appModel: AppModel?

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

    /// Latest server-pushed live download progress, `mediaId → (downloadId →
    /// live)`. Fed by `.downloadProgress` SSE events; `MediaDetailView` overlays
    /// the inner map onto its download rows so the progress bar tracks the
    /// pushed value between fetches. iOS has no client-side poll — this stream
    /// is the live source, mirroring the web app's cache patch.
    private(set) var downloadProgress: [Int: [Int: LiveDownload]] = [:]

    /// Kept live by the notification stream and by `NotificationsListView`'s
    /// own REST calls; drives the Home bell badge.
    private(set) var unreadNotificationCount = 0
    /// The most recent live notification, shown as a transient top banner and
    /// cleared after a few seconds — the iOS analog of the web app's
    /// `NotificationToastContainer`. `id` lets `NotificationBannerView` key its
    /// dismiss timer per-notification instead of restarting on unrelated
    /// re-renders.
    private(set) var bannerNotification: StreamNotificationDTO?

    private var libraryEventsTask: Task<Void, Never>?
    private var notificationStreamTask: Task<Void, Never>?
    private var bannerDismissTask: Task<Void, Never>?

    private(set) var libraryStreamStatus: SSEStreamStatus = .idle
    private(set) var notificationStreamStatus: SSEStreamStatus = .idle
    /// Newest first, capped so a long-open debug screen can't grow unbounded.
    private(set) var sseDebugLog: [SSEDebugLogEntry] = []
    private let sseDebugLogLimit = 200

    private func logSSE(_ stream: String, _ summary: String) {
        sseDebugLog = appendSSELog(
            sseDebugLog,
            entry: SSEDebugLogEntry(timestamp: Date(), stream: stream, summary: summary),
            limit: sseDebugLogLimit
        )
    }

    /// Forces both SSE connections closed and immediately reopens them, so the
    /// SSE debug screen can reproduce the reconnect path on demand instead of
    /// waiting for a real network drop.
    func forceReconnect() {
        stop()
        start()
    }

    /// Starts the library-events and notification SSE consumers if they
    /// aren't already running. Call when the app becomes active while signed
    /// in (see `RawkoonApp`'s `scenePhase` handling); a no-op when logged out
    /// or already running.
    func start() {
        guard appModel?.isLoggedIn == true else { return }
        if libraryEventsTask == nil {
            libraryEventsTask = Task { [weak self] in
                await self?.runLibraryEventsLoop()
                // The loop also returns on its own (a 401, or the client going
                // away) — not just on cancellation. Clear the handle on those
                // natural exits so the next `.active` can start a fresh stream;
                // skip it when cancelled, since `stop` already nil'd
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
    func stop() {
        libraryEventsTask?.cancel()
        libraryEventsTask = nil
        notificationStreamTask?.cancel()
        notificationStreamTask = nil
        libraryStreamStatus = .idle
        notificationStreamStatus = .idle
        downloadProgress = [:]
    }

    /// Consumes `/api/library/events` until cancelled or unauthorized,
    /// reconnecting with exponential backoff (capped at 30s) on any other
    /// drop — the connection is expected to close periodically (idle
    /// timeouts, backgrounding at the edge, server restarts).
    private func runLibraryEventsLoop() async {
        var backoff = 1.0
        while !Task.isCancelled {
            guard let client = appModel?.api() else { return }
            libraryStreamStatus = .connecting
            do {
                for try await event in await client.libraryEventsStream() {
                    if case .handshake = event {
                        backoff = 1.0
                    }
                    handleLibraryEvent(event)
                }
            } catch APIError.unauthorized {
                Log.sync.notice("library events stream unauthorized — signing out")
                appModel?.handleSessionExpired()
                return
            } catch APIError.forbidden {
                Log.sync.notice("library events stream forbidden — not reconnecting")
                return
            } catch {
                Log.sync.debug("library events stream dropped: \(error.localizedDescription, privacy: .public)")
                logSSE("library", "dropped: \(error.localizedDescription)")
            }
            libraryStreamStatus = .reconnecting
            if Task.isCancelled {
                return
            }
            try? await Task.sleep(for: .seconds(backoff))
            backoff = min(backoff * 2, 30)
        }
    }

    /// Apply one decoded library-events SSE event to local state. Split out of
    /// the reconnect loop so that loop stays a thin transport concern.
    private func handleLibraryEvent(_ event: LibraryEvent) {
        guard let store = appModel?.serverStateStore else { return }
        switch event {
        case .handshake:
            libraryStreamStatus = .connected
            logSSE("library", "handshake")
            SSEEventRegistry.apply(.libraryHandshake, to: store)
        case let .media(id):
            logSSE("library", "media id=\(id)")
            SSEEventRegistry.apply(.media(id: id), to: store)
            libraryChangeToken += 1
        case let .book(id):
            logSSE("library", "book id=\(id)")
            SSEEventRegistry.apply(.book(id: id), to: store)
            bookChangeToken += 1
        case let .downloadProgress(mediaId, items):
            logSSE("library", "download-progress media=\(mediaId) rows=\(items.count)")
            applyDownloadProgress(mediaId: mediaId, items: items)
        }
    }

    /// Store the latest pushed progress for one media. Replaces that media's
    /// map wholesale — each event carries every active row for the media, so a
    /// row that dropped out (completed/failed) simply stops appearing.
    private func applyDownloadProgress(mediaId: Int, items: [DownloadProgressEntry]) {
        downloadProgress[mediaId] = downloadProgressMap(items)
    }

    /// Consumes `/api/notifications/stream` the same way — see
    /// `runLibraryEventsLoop`. Each event bumps the unread count and shows the
    /// transient in-app banner; it does not itself update the notification
    /// list (open `NotificationsListView` refetches on appear/pull-to-refresh).
    private func runNotificationStreamLoop() async {
        var backoff = 1.0
        while !Task.isCancelled {
            guard let client = appModel?.api() else { return }
            notificationStreamStatus = .connecting
            do {
                for try await notification in await client.notificationStream() {
                    backoff = 1.0
                    notificationStreamStatus = .connected
                    logSSE("notifications", "id=\(notification.id) title=\(notification.title)")
                    if let store = appModel?.serverStateStore {
                        SSEEventRegistry.apply(.notification, to: store)
                        LibraryNotification.apply(notification, to: store)
                    }
                    unreadNotificationCount += 1
                    syncAppIconBadge()
                    notificationChangeToken += 1
                    if !LibraryNotification.isSilent(notification) {
                        showBanner(notification)
                    }
                }
            } catch APIError.unauthorized {
                Log.sync.notice("notification stream unauthorized — signing out")
                appModel?.handleSessionExpired()
                return
            } catch APIError.forbidden {
                Log.sync.notice("notification stream forbidden — not reconnecting")
                return
            } catch {
                Log.sync.debug("notification stream dropped: \(error.localizedDescription, privacy: .public)")
                logSSE("notifications", "dropped: \(error.localizedDescription)")
            }
            notificationStreamStatus = .reconnecting
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
        appModel?.deepLinkTarget = destination
    }

    /// Best-effort unread-count refresh — called after sign-in and whenever
    /// `NotificationsListView` changes read state server-side.
    func refreshUnreadCount() async {
        guard let client = appModel?.api() else { return }
        if let response = try? await client.unreadNotificationCount() {
            unreadNotificationCount = response.unreadCount
            syncAppIconBadge()
        }
    }

    /// Clears the unread count and its badge — called on logout.
    func resetUnreadCount() {
        unreadNotificationCount = 0
        syncAppIconBadge()
    }

    /// Bumps the book change token so book-watching views reload — called after
    /// a local mutation (e.g. marking a book read) that the SSE stream won't
    /// echo back to this device.
    func bumpBookChangeToken() {
        bookChangeToken += 1
    }

    /// Reconciles the app-icon badge with `unreadNotificationCount`. Pure
    /// mapping lives in `NotificationBadge` (Kit); this just applies it.
    private func syncAppIconBadge() {
        let n = NotificationBadge.value(forUnread: unreadNotificationCount)
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(n) }
    }
}
