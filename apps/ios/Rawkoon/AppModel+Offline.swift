import Foundation
import RawkoonKit

/// Saved server data and the offline → online handoff: what the app shows
/// before (or instead of) the network answering, and what it resends once the
/// connection is back.
extension AppModel {
    /// No network path at all. Drives the offline strip and disables actions that
    /// need the server; a reachable network with a down server is not "offline".
    var isOffline: Bool {
        !isOnline
    }

    // MARK: Saved data

    /// Saved responses plus cached artwork, in bytes.
    var savedDataBytes: Int {
        (session.apiClient?.responseCache?.diskUsage() ?? 0) + PosterCache.diskUsage
    }

    /// Frees the saved copies without signing out; screens refill on their next load.
    func clearSavedData() {
        session.apiClient?.responseCache?.removeAll()
        PosterCache.removeAll()
        UserDefaults.standard.removeObject(forKey: "offline_prefetch_at")
    }

    /// Paints the profile and the book library from the last saved responses, so
    /// a cold launch shows the user's own name and books before (or without) the
    /// network.
    func hydrateFromCache() {
        guard let apiClient = session.apiClient else { return }
        if session.userFirstName == nil, let cached = apiClient.cached(Endpoints.currentUser),
           let user = cached.value.user
        {
            session.applyUser(user)
        }
        libraryStore.hydrateFromCache()
    }

    // MARK: Back online

    /// Everything a reconnect should catch up on, after the path monitor reports
    /// a usable network again.
    func handleReconnect() {
        for downloader in downloads.downloaders.values {
            downloader.retryFailedChapters()
        }
        guard isLoggedIn else { return }
        // Skip the stream's backoff (up to 30s); its handshake revalidates the lists.
        liveUpdates.forceReconnect()
        refreshAfterServerReturn()
    }

    /// The server answers again after a gap: refetch what screens painted from
    /// saved data and resend what was recorded meanwhile.
    func refreshAfterServerReturn() {
        guard isLoggedIn else { return }
        reconnectToken += 1
        Task {
            let passStart = Date()
            await libraryStore.loadLibrary()
            await session.refreshAdmin()
            await refreshUnreadNotificationCount()
            await progress.pushOfflineProgress(libraryFreshSince: passStart)
        }
    }
}
