import Foundation
import RawkoonKit

extension AppModel {
    /// Authenticated 401 — the Keychain token is stale. Drop the session so
    /// the next frame shows LoginView rather than retrying forever.
    func handleSessionExpired() {
        guard isLoggedIn else { return }
        Log.auth.notice("session expired (401) — signing out")
        logout()
    }

    func logout() {
        WidgetSnapshotWriter.shared.clear()
        ReencodeActivityCoordinator.shared.stop(model: self)
        session.unregisterPushToken()
        session.resetServerFeatures()
        // Answers a waiting add so its caller stops spinning.
        router.addRequest?.finish(nil)
        router.addRequest = nil

        stopLiveStreams()
        serverStateStore.clear()
        dismissBanner()
        router.deepLinkTarget = nil
        liveUpdates.resetUnreadCount()

        // First, while the client can still send the final position; it also
        // drops the Now Playing entry a logged-out app could not serve.
        closePlayer()

        session.deleteStoredCredentials()
        clearServerScope()
        session.cancelProfileFetch()
        session.dropAPIClient()
        // Images the server serves were fetched with this account's token; an
        // in-flight prefetch would write them back after the wipe.
        prefetchTask?.cancel()
        PosterCache.removeAll()
        session.clearIdentity()
        pendingRequestCount = 0
        library = []
        libraryFetchedAt = nil
        manifests = [:]
        for (editionId, downloader) in downloaders {
            invalidatingSessions.insert(editionId)
            downloader.cancel { [weak self] in
                Task { @MainActor in self?.invalidatingSessions.remove(editionId) }
            }
        }
        downloaders = [:]
        downloadPlans = [:]
        verifiedCounts = [:]
        downloadServerKeys = [:]
    }
}
