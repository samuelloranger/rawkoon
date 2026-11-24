import Foundation
import RawkoonKit

/// Runs `operation`, giving up and returning nil after `seconds`.
///
/// The losing child is cancelled, but a URLSession call already in flight keeps
/// running to its own timeout in the background; the point is only that the
/// caller stops waiting on it.
func withDeadline<T: Sendable>(
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

extension ProgressStore {
    /// The write a reconciled resume point implies, held rather than performed so
    /// the decision can also be read without side effects.
    private enum ResumeEffect {
        case none
        case adoptRemote(PositionEntry)
        case pushLocal(positionSecs: Double, updatedAtMillis: Int64)
    }

    /// Takes the total rather than the manifest: the button label needs a resume
    /// point before the manifest has necessarily loaded.
    private func reconcileResumePosition(
        editionId: Int,
        totalDurationSecs: Double
    ) async -> (positionSecs: Double, effect: ResumeEffect) {
        let localEntry = await journalEntries()[editionId]
        let localRecord = localEntry.map {
            ProgressRecord(
                positionSecs: $0.positionSecs,
                totalDurationSecs: totalDurationSecs,
                finished: isListeningFinished(positionSecs: $0.positionSecs, totalDurationSecs: totalDurationSecs),
                updatedAtMillis: $0.atMillis
            )
        }

        // Same deadline as the ebook path: a downloaded book must not wait on an
        // unreachable server before it plays.
        var remoteProgress: [RemoteProgress]?
        if isOnline(), let apiClient = session.apiClient {
            remoteProgress = await withDeadline(seconds: 5) {
                try? await apiClient.getProgress()
            }
        }
        var remoteRecord: ProgressRecord?
        if let remote = remoteProgress?.first(where: { $0.editionId == editionId }) {
            remoteRecord = ProgressRecord(
                positionSecs: remote.positionSecs,
                totalDurationSecs: remote.totalDurationSecs,
                finished: remote.finished,
                updatedAtMillis: Int64(remote.updatedAt.timeIntervalSince1970 * 1000)
            )
        }

        // Marking a book read deletes its server row; pushing the journal's
        // stale position back would put it in progress again.
        // A listen after the mark (offline, in the car) is newer than read_at and
        // still pushes.
        if remoteProgress != nil, remoteRecord == nil,
           markedReadSince(editionId: editionId, journalAtMillis: localRecord?.updatedAtMillis ?? 0)
        {
            return (0, .none)
        }

        switch SyncReconciler.reconcile(local: localRecord, remote: remoteRecord) {
        case .keepLocal:
            return (localRecord?.positionSecs ?? 0, .none)
        case .takeRemote:
            guard let remoteRecord else { return (localRecord?.positionSecs ?? 0, .none) }
            let adjusted = SyncReconciler.adjust(remoteRecord, toTotal: totalDurationSecs)
            let entry = PositionEntry(
                editionId: editionId,
                positionSecs: adjusted.positionSecs,
                atMillis: adjusted.updatedAtMillis
            )
            return (adjusted.positionSecs, .adoptRemote(entry))
        case .push:
            guard let localRecord else { return (0, .none) }
            return (
                localRecord.positionSecs,
                .pushLocal(
                    positionSecs: localRecord.positionSecs,
                    updatedAtMillis: localRecord.updatedAtMillis
                )
            )
        }
    }

    /// True when the book was marked read at or after the journal entry, so a server with
    /// no progress row means "read", not "never listened".
    func markedReadSince(editionId: Int, journalAtMillis: Int64) -> Bool {
        guard let readAt = libraryStore.library.first(where: { $0.audiobookEditionId == editionId })?.readAt,
              let readDate = APIClient.iso8601WithFractionalSeconds.date(from: readAt)
              ?? ISO8601DateFormatter().date(from: readAt)
        else { return false }
        return journalAtMillis <= Int64(readDate.timeIntervalSince1970 * 1000)
    }

    func resolveResumePosition(editionId: Int, manifest: BookManifest) async -> Double {
        let (positionSecs, effect) = await reconcileResumePosition(
            editionId: editionId,
            totalDurationSecs: manifest.totalDurationSecs
        )
        switch effect {
        case .none:
            break
        case let .adoptRemote(entry):
            appendJournal(entry)
        case let .pushLocal(pushed, updatedAtMillis):
            sendProgress(
                editionId: editionId,
                positionSecs: pushed,
                totalDurationSecs: manifest.totalDurationSecs,
                updatedAtMillis: updatedAtMillis
            )
        }
        resumePreview[editionId] = positionSecs
        // A finished book replays from the start instead of ending on load.
        return playStartPosition(positionSecs: positionSecs, durationSecs: manifest.totalDurationSecs)
    }

    /// Fills `resumePreview` so a book's primary button can name the point it
    /// will resume at. Deliberately read-only: opening a detail screen must not
    /// adopt a remote position or push a local one — only starting playback does.
    func loadResumePreview(editionId: Int, totalDurationSecs: Double) async {
        guard totalDurationSecs > 1 else { return }
        let (positionSecs, _) = await reconcileResumePosition(
            editionId: editionId,
            totalDurationSecs: totalDurationSecs
        )
        resumePreview[editionId] = positionSecs
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
        if isOnline(), let apiClient = session.apiClient {
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

    /// Fills `readingResumePreview` so a book's Read button can name where it
    /// will reopen. Unlike the audiobook preview this may mirror a remote
    /// position into the local store — that is `readingPosition`'s own offline
    /// cache warm, not a write back to the server.
    func loadReadingResumePreview(editionId: Int) async {
        readingResumePreview[editionId] = await readingPosition(editionId: editionId)
    }

    /// Persists locally first, then pushes. The local write is what makes the
    /// position survive a crash or an offline session; the push is best-effort.
    func saveReadingPosition(_ position: ReadingPosition) {
        try? readingProgressStore.save(position)
        guard let apiClient = session.apiClient else { return }
        Task { try? await apiClient.putReadingProgress(position, deviceId: session.deviceID) }
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
