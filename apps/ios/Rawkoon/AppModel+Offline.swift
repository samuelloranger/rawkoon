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

    // MARK: Response cache

    private static func responseCacheRoot() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ResponseCache", isDirectory: true)
    }

    static func makeResponseCache(server: String) -> ResponseCache {
        ResponseCache(
            directory: responseCacheRoot()
                .appendingPathComponent(ResponseCache.namespace(forServer: server), isDirectory: true)
        )
    }

    /// Sign-out drops every server's saved responses: they belong to the account
    /// that fetched them.
    func wipeResponseCache() {
        try? FileManager.default.removeItem(at: Self.responseCacheRoot())
    }

    /// Saved responses plus cached artwork, in bytes.
    var savedDataBytes: Int {
        (apiClient?.responseCache?.diskUsage() ?? 0) + PosterCache.diskUsage
    }

    /// Frees the saved copies without signing out; screens refill on their next load.
    func clearSavedData() {
        apiClient?.responseCache?.removeAll()
        PosterCache.removeAll()
        UserDefaults.standard.removeObject(forKey: "offline_prefetch_at")
    }

    /// Paints the profile and the book library from the last saved responses, so
    /// a cold launch shows the user's own name and books before (or without) the
    /// network.
    func hydrateFromCache() {
        guard let apiClient else { return }
        if userFirstName == nil, let cached = apiClient.cached(Endpoints.currentUser),
           let user = cached.value.user
        {
            applyUser(user)
        }
        if library.isEmpty, let cached = apiClient.cachedLibraryBooks() {
            library = Self.sortedLibrary(cached.value)
        }
    }

    func applyUser(_ user: SessionUser) {
        isAdmin = user.isAdmin ?? false
        userId = user.id
        updateServerScope(userId: user.id)
        let full = [user.firstName, user.lastName].compactMap(\.self).joined(separator: " ")
        userFirstName = user.firstName ?? (full.isEmpty ? user.name : full)
        userInitials = UserInitials.from(firstName: user.firstName, lastName: user.lastName, name: user.name)
        userAvatarURL = absoluteURL(user.avatarUrl)
    }

    static func sortedLibrary(_ items: [BookListItem]) -> [BookListItem] {
        BookOrdering.sorted(items) {
            BookOrderKey(id: $0.bookId, title: $0.title, isInProgress: false, isDownloaded: false)
        }
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
            await loadLibrary()
            await refreshAdmin()
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
        guard let apiClient, let remote = try? await apiClient.getProgress() else { return }
        let remoteByEdition = Dictionary(remote.map { ($0.editionId, $0) }, uniquingKeysWith: { first, _ in first })

        for (editionId, entry) in await journalEntries() {
            let server = remoteByEdition[editionId]
            let total = server?.totalDurationSecs ?? DownloadedStore.readManifest(editionId: editionId)?.totalDurationSecs ?? 0
            guard total > 0 else { continue }
            if server == nil {
                // A cached library can hold a stale readAt; only a fetch from this pass can rule out "marked read".
                guard let fetched = libraryFetchedAt, fetched >= passStart,
                      library.contains(where: { $0.audiobookEditionId == editionId }),
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
                deviceId: deviceID
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
            try? await apiClient.putReadingProgress(local, deviceId: deviceID)
        }
    }
}
