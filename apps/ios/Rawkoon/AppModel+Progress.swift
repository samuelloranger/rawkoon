import Foundation
import RawkoonKit

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

extension AppModel {
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
        let localEntry = PositionJournal.latest(in: readJournal(), editionId: editionId)
        let localRecord = localEntry.map {
            ProgressRecord(
                positionSecs: $0.positionSecs,
                totalDurationSecs: totalDurationSecs,
                finished: $0.positionSecs >= totalDurationSecs,
                updatedAtMillis: $0.atMillis
            )
        }

        // Same deadline as the ebook path: a downloaded book must not wait on an
        // unreachable server before it plays.
        var remoteProgress: [RemoteProgress]?
        if isOnline, let apiClient {
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
        if remoteProgress != nil, remoteRecord == nil,
           library.first(where: { $0.audiobookEditionId == editionId })?.isRead == true
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

    func persistPlaybackProgress(force: Bool) {
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

    func readJournal() -> String {
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
}
