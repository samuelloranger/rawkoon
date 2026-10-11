import Foundation
import RawkoonKit
import UIKit
import UserNotifications

extension AppModel {
    /// Drops an edition's index record once its last downloaded file is gone.
    func forgetDownloadedEdition(editionId: Int) {
        DownloadedStore.forget(editionId: editionId)
        refreshDownloadedBookIds()
    }

    /// Rehydrates in-memory manifests and download plans from disk so a process
    /// kill does not look like "Chapters couldn't load" / a missing download.
    func restoreDownloadedAudiobooks() {
        var editionIds = Set(
            DownloadedStore.readIndex()
                .filter { $0.kind == .audiobook }
                .map(\.editionId)
        )
        let root = FileStore.booksDirectory()
        if let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) {
            for name in names {
                if let id = Int(name) {
                    editionIds.insert(id)
                }
            }
        }
        for editionId in editionIds {
            guard let manifest = DownloadedStore.readManifest(editionId: editionId) else {
                continue
            }
            manifests[editionId] = manifest
            let existingBytes = Self.onDiskBytes(editionId: editionId, files: manifest.files)
            // Only surface a plan when files are actually on disk. A manifest-only
            // cache (written at download-start) must not look like an in-flight
            // 0% download after a process kill — there is no live downloader.
            let plan = DownloadPlan.restored(
                files: manifest.files,
                existingBytes: existingBytes
            )
            if plan.isComplete {
                downloadPlans[editionId] = plan
            }
        }
    }

    func startDownload(editionId: Int, preferDiskManifest: Bool = false) async {
        errorMessage = nil
        // The manifest await below is a window where a second call (a re-tap, a
        // background relaunch) would build a second downloader on the same session id.
        guard !startingDownloads.contains(editionId) else { return }
        startingDownloads.insert(editionId)
        defer { startingDownloads.remove(editionId) }
        // A just-cancelled session with this identifier may still be invalidating.
        for _ in 0 ..< 50 where invalidatingSessions.contains(editionId) {
            try? await Task.sleep(for: .milliseconds(100))
        }

        do {
            // Fresh grants: a restored disk manifest is enough to list chapters
            // but its signed URLs may already have expired. A background relaunch
            // takes the disk copy anyway: it must reattach the session before its
            // time runs out, and an expired grant is refreshed through the 401 path.
            let diskManifest = preferDiskManifest ? DownloadedStore.readManifest(editionId: editionId) : nil
            let manifest = if let diskManifest {
                diskManifest
            } else {
                try await manifest(editionId, forceRefresh: true)
            }
            manifests[editionId] = manifests[editionId] ?? manifest
            DownloadedStore.writeManifest(manifest, editionId: editionId)
            guard let baseURL = URL(string: serverURL) else {
                errorMessage = String(localized: "Enter a valid server URL.")
                return
            }
            if let existing = downloaders[editionId] {
                // Re-tap means "try again": fresh grants, given-up chapters cleared.
                grantRefreshAttempts.removeValue(forKey: editionId)
                existing.refreshChapterURLs(from: manifest)
                existing.retryFailedChapters()
                existing.start()
                return
            }

            let downloader = ChapterDownloader(
                editionId: editionId,
                baseURL: baseURL,
                manifest: manifest
            ) { [weak self] snapshot in
                // Already on the main queue (FIFO); a Task hop could apply an older snapshot last.
                MainActor.assumeIsolated {
                    self?.applyDownloadSnapshot(snapshot, editionId: editionId)
                }
            }
            if let pending = pendingBackgroundCompletions.first(where: { downloader.hasBackgroundSession(identifier: $0.key) }) {
                downloader.setBackgroundSessionCompletion(pending.value)
                pendingBackgroundCompletions.removeValue(forKey: pending.key)
            }

            downloaders[editionId] = downloader
            downloader.start()
        } catch {
            errorMessage = message(for: error)
        }
    }

    func handleBackgroundEvents(identifier: String, completionHandler: @escaping () -> Void) {
        if let downloader = downloaders.values.first(where: { $0.hasBackgroundSession(identifier: identifier) }) {
            downloader.setBackgroundSessionCompletion(completionHandler)
            downloader.start()
            return
        }

        pendingBackgroundCompletions[identifier] = completionHandler

        // The `downloaders` map is in-memory, so after the app was terminated it
        // is empty and nothing is attached to the session. iOS delivers
        // `didFinishDownloadingTo` only to a delegate, and discards the
        // temporary file if none exists — so the downloader has to be rebuilt
        // here rather than waiting for the user to tap download again.
        // `startDownload` picks the pending completion up by identifier.
        guard let editionId = ChapterDownloader.editionId(fromSessionIdentifier: identifier) else {
            pendingBackgroundCompletions.removeValue(forKey: identifier)
            completionHandler()
            return
        }
        Task { await startDownload(editionId: editionId, preferDiskManifest: true) }
    }

    func deleteDownloads() {
        let editionIDs = Set(library.compactMap(\.audiobookEditionId))
            .union(manifests.keys)
            .union(downloadPlans.keys)

        // Through purgeDownload so each live downloader goes too; a surviving one
        // re-reports its all-verified plan and re-lists the book with no files.
        for editionId in editionIDs {
            purgeDownload(editionId: editionId)
        }
    }

    /// Cancels an in-progress audiobook download and discards its partial
    /// files. One tap, no confirmation: nothing finished is lost, and the
    /// chapters re-fetch on the next Download tap.
    func cancelDownload(editionId: Int) {
        purgeDownload(editionId: editionId)
    }

    /// Removes a fully downloaded audiobook from the device. The UI confirms
    /// this because it throws away completed files.
    func removeDownload(editionId: Int) {
        purgeDownload(editionId: editionId)
    }

    /// Tears down any live downloader, deletes the edition's files, and clears
    /// its plan. A straggling task cannot re-create the directory because the
    /// downloader is cancelled before the files go.
    private func purgeDownload(editionId: Int) {
        if let downloader = downloaders.removeValue(forKey: editionId) {
            invalidatingSessions.insert(editionId)
            downloader.cancel { [weak self] in
                Task { @MainActor in self?.invalidatingSessions.remove(editionId) }
            }
        }
        let removed = FileStore.deleteEdition(editionId)
        DownloadedStore.forget(editionId: editionId)
        refreshDownloadedBookIds()
        if !removed {
            toast(String(localized: "Couldn't delete all downloaded files."), style: .error)
        }
        downloadPlans.removeValue(forKey: editionId)
        verifiedCounts.removeValue(forKey: editionId)
        chapterFractions.removeValue(forKey: editionId)
        downloadFractions.removeValue(forKey: editionId)
        // The playing book keeps streaming, and progress saving needs its manifest.
        if activeEditionId != editionId {
            manifests.removeValue(forKey: editionId)
        }
        // Otherwise a stale attempt count could trip maxGrantRefreshAttempts on
        // the next download of this edition.
        grantRefreshAttempts.removeValue(forKey: editionId)
        grantRefreshInFlight.remove(editionId)
        if activeEditionId == editionId {
            player.rebuild()
        }
        // Same signal as a completed download: the book screen has missed plan removals too.
        postDownloadStateChanged(editionId: editionId)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(300))
            self?.postDownloadStateChanged(editionId: editionId)
        }
    }

    private func postDownloadStateChanged(editionId: Int) {
        NotificationCenter.default.post(
            name: .audiobookDownloadStateChanged, object: nil, userInfo: ["editionId": editionId]
        )
    }

    /// Replaces the downloader's signed URLs after a grant expired.
    ///
    /// The plan requeues a 401/403 chapter without spending an attempt, so
    /// without this the same dead URL is pumped forever. Capped, because a
    /// rotated server secret makes every refetch land on the same wall.
    private func refreshGrants(editionId: Int) async {
        guard !grantRefreshInFlight.contains(editionId) else { return }
        let attempts = grantRefreshAttempts[editionId] ?? 0
        guard attempts < Self.maxGrantRefreshAttempts else {
            errorMessage = String(localized: "Downloads for this book need a fresh sign-in.")
            downloaders[editionId]?.grantRefreshFailed()
            return
        }
        grantRefreshInFlight.insert(editionId)
        grantRefreshAttempts[editionId] = attempts + 1
        defer { grantRefreshInFlight.remove(editionId) }

        do {
            // Straight to the API: manifest(forceRefresh:) falls back to the disk
            // copy, whose URLs are the expired ones being replaced.
            guard let apiClient else { throw APIError.unauthorized }
            let refreshed = try await apiClient.manifest(editionId: editionId)
            manifests[editionId] = refreshed
            downloaders[editionId]?.refreshChapterURLs(from: refreshed)
        } catch {
            downloaders[editionId]?.grantRefreshFailed()
            Log.download.error(
                """
                Grant refresh failed: \
                editionId=\(editionId, privacy: .public) \
                error=\(error.localizedDescription, privacy: .public)
                """
            )
        }
    }

    private static let maxGrantRefreshAttempts = 3

    func applyDownloadSnapshot(_ snapshot: DownloadSnapshot, editionId: Int) {
        let plan = snapshot.plan
        let shownCount = verifiedCounts[editionId]
        let incomingCount = verifiedFileCount(in: plan)
        if shownCount != incomingCount || plan.isComplete {
            DownloadJournal(editionId: editionId).log(
                "apply rev=\(snapshot.revision) verified \(shownCount.map(String.init) ?? "-")->\(incomingCount) complete=\(plan.isComplete) hasDownloader=\(downloaders[editionId] != nil)"
            )
        }
        // A late callback from a downloader that `purgeDownload` already dropped
        // (cancel/remove) must not resurrect the plan or the deleted files.
        guard downloaders[editionId] != nil else { return }
        // Snapshots now stream during byte progress; ask for grants once per expiry.
        let wasWaitingForGrants = downloadPlans[editionId]?.needsFreshGrants ?? false
        if plan.needsFreshGrants, !wasWaitingForGrants {
            Task { await refreshGrants(editionId: editionId) }
        }

        let newCount = verifiedFileCount(in: plan)

        downloadPlans[editionId] = plan
        verifiedCounts[editionId] = newCount
        if plan.isComplete {
            chapterFractions.removeValue(forKey: editionId)
            downloadFractions.removeValue(forKey: editionId)
        } else {
            chapterFractions[editionId] = snapshot.chapterFractions
            downloadFractions[editionId] = snapshot.overallFraction
        }

        // When the last chapter verifies, persist what the offline library needs
        // to list and play this audiobook without the network. Guard on a
        // missing on-disk manifest so this runs once per completed download, not
        // on every state emission.
        if plan.isComplete, !isIndexedAsDownloaded(editionId) {
            persistDownloadedAudiobook(editionId: editionId)
            notifyDownloadComplete(editionId: editionId)
        }
        // Observation alone sometimes left the book screen on a finished ring; this reaches
        // it through its own @State (see BookView .onReceive).
        if newCount != shownCount || plan.isComplete {
            postDownloadStateChanged(editionId: editionId)
            // A second signal once the dust settles, in case the first was read mid-write.
            if plan.isComplete {
                Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .milliseconds(300))
                    self?.postDownloadStateChanged(editionId: editionId)
                }
            }
        }
    }

    /// Only when the app is not on screen: that is when nobody sees the card flip.
    private func notifyDownloadComplete(editionId: Int) {
        guard UIApplication.shared.applicationState != .active else { return }
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Download complete")
        content.body = library.first { $0.audiobookEditionId == editionId }?.title ?? ""
        content.sound = .default
        let request = UNNotificationRequest(identifier: "download-complete-\(editionId)", content: content, trigger: nil)
        Task { try? await UNUserNotificationCenter.current().add(request) }
    }

    /// Recovers chapters whose completion never arrived; see `ChapterDownloader.resync`.
    func resyncDownloads() {
        for downloader in downloaders.values {
            downloader.resync()
        }
    }

    /// Snapshots a freshly-completed audiobook into the offline store — see
    /// `OfflineLibraryStore.persistAudiobook`. Reads the manifest and book this
    /// model already holds and hands them off.
    func persistDownloadedAudiobook(editionId: Int) {
        guard let manifest = manifests[editionId] else { return }
        let book = library.first { $0.audiobookEditionId == editionId }
        OfflineLibraryStore.persistAudiobook(editionId: editionId, manifest: manifest, book: book)
        refreshDownloadedBookIds()
        FileStore.deleteChapters(editionId: editionId, keeping: Set(manifest.files.map(\.id)))
    }

    /// Records a downloaded ebook into the offline store — see
    /// `OfflineLibraryStore.recordEbookDownloaded`. Called by the Book screen
    /// after a file finishes downloading; `editionId` is the storage id the
    /// on-disk file uses.
    func recordEbookDownloaded(
        editionId: Int,
        bookId: Int,
        title: String,
        author: String?,
        coverURL: URL?,
        files: [BookEditionFile],
        downloadedFileCount: Int
    ) {
        OfflineLibraryStore.recordEbookDownloaded(
            editionId: editionId, bookId: bookId, title: title, author: author,
            coverURL: coverURL, files: files, downloadedFileCount: downloadedFileCount
        )
        refreshDownloadedBookIds()
    }

    /// The persisted ebook file list for a downloaded edition, or nil — see
    /// `OfflineLibraryStore.ebookFiles`. The Book screen falls back to this when
    /// the server is unreachable.
    func offlineEbookFiles(editionId: Int) -> [BookEditionFile]? {
        OfflineLibraryStore.ebookFiles(editionId: editionId)
    }

    private func verifiedFileCount(in plan: DownloadPlan) -> Int {
        plan.files.reduce(into: 0) { count, file in
            if plan.states[file.id] == .verified {
                count += 1
            }
        }
    }
}
