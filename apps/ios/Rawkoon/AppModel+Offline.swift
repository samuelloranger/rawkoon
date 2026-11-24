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
        for downloader in downloaders.values {
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
            await pushOfflineProgress(libraryFreshSince: passStart)
        }
    }

    /// Sends positions recorded while the server was out of reach. The push at
    /// play time is fire-and-forget, so a drive through a dead zone otherwise
    /// leaves the server behind until that book is opened again.
    ///
    /// With no server row the book may have been marked read; push only when this pass
    /// fetched the library and the journal line is newer than any read mark.
    func pushOfflineProgress(libraryFreshSince passStart: Date) async {
        guard let apiClient = session.apiClient, let remote = try? await apiClient.getProgress() else { return }
        let remoteByEdition = Dictionary(remote.map { ($0.editionId, $0) }, uniquingKeysWith: { first, _ in first })

        for (editionId, entry) in await journalEntries() {
            let server = remoteByEdition[editionId]
            let total = server?.totalDurationSecs ?? DownloadedStore.readManifest(editionId: editionId)?.totalDurationSecs ?? 0
            guard total > 0 else { continue }
            if server == nil {
                // A cached library can hold a stale readAt; only a fetch from this pass can rule out "marked read".
                guard let fetched = libraryStore.libraryFetchedAt, fetched >= passStart,
                      libraryStore.library.contains(where: { $0.audiobookEditionId == editionId }),
                      !markedReadSince(editionId: editionId, journalAtMillis: entry.atMillis)
                else { continue }
            }
            let local = ProgressRecord(
                positionSecs: entry.positionSecs,
                totalDurationSecs: total,
                finished: isListeningFinished(positionSecs: entry.positionSecs, totalDurationSecs: total),
                updatedAtMillis: entry.atMillis
            )
            let remoteRecord = server.map {
                ProgressRecord(
                    positionSecs: $0.positionSecs,
                    totalDurationSecs: $0.totalDurationSecs,
                    finished: $0.finished,
                    updatedAtMillis: Int64($0.updatedAt.timeIntervalSince1970 * 1000)
                )
            }
            guard SyncReconciler.reconcile(local: local, remote: remoteRecord) == .push else { continue }
            try? await apiClient.putProgress(
                editionId: editionId,
                positionSecs: entry.positionSecs,
                totalDurationSecs: total,
                finished: isListeningFinished(positionSecs: entry.positionSecs, totalDurationSecs: total),
                updatedAt: Date(timeIntervalSince1970: Double(entry.atMillis) / 1000),
                deviceId: session.deviceID
            )
        }

        guard let remoteReading = try? await apiClient.readingProgress() else { return }
        let readingByEdition = Dictionary(
            remoteReading.map { ($0.editionId, $0) }, uniquingKeysWith: { first, _ in first }
        )
        for (editionId, local) in readingProgressStore.all() {
            guard let server = readingByEdition[editionId],
                  ReadingProgressReconciler.reconcile(local: local, remote: server) == .push
            else { continue }
            try? await apiClient.putReadingProgress(local, deviceId: session.deviceID)
        }
    }
}
