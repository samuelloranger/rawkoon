import Foundation
import RawkoonKit
import UIKit
import UserNotifications

extension DownloadsStore {
    func deleteDownloads() {
        let editionIDs = Set(libraryStore.library.compactMap(\.audiobookEditionId))
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
            router.toast(String(localized: "Couldn't delete all downloaded files."), style: .error)
        }
        downloadPlans.removeValue(forKey: editionId)
        verifiedCounts.removeValue(forKey: editionId)
        chapterFractions.removeValue(forKey: editionId)
        downloadFractions.removeValue(forKey: editionId)
        // The playing book keeps streaming, and progress saving needs its manifest.
        if activeEditionId() != editionId {
            manifests.removeValue(forKey: editionId)
        }
        // Otherwise a stale attempt count could trip maxGrantRefreshAttempts on
        // the next download of this edition.
        grantRefreshAttempts.removeValue(forKey: editionId)
        grantRefreshInFlight.remove(editionId)
        if activeEditionId() == editionId {
            rebuildPlayer()
        }
        // Same signal as a completed download: the book screen has missed plan removals too.
        postDownloadStateChanged(editionId: editionId)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(300))
            self?.postDownloadStateChanged(editionId: editionId)
        }
    }

    func postDownloadStateChanged(editionId: Int) {
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
            session.errorMessage = String(localized: "Downloads for this book need a fresh sign-in.")
            downloaders[editionId]?.grantRefreshFailed()
            return
        }
        grantRefreshInFlight.insert(editionId)
        grantRefreshAttempts[editionId] = attempts + 1
        defer { grantRefreshInFlight.remove(editionId) }

        do {
            // Straight to the API: manifest(forceRefresh:) falls back to the disk
            // copy, whose URLs are the expired ones being replaced.
            guard let apiClient = session.apiClient else { throw APIError.unauthorized }
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
        content.title = String(localized: "Download finished")
        content.body = libraryStore.library.first { $0.audiobookEditionId == editionId }?.title ?? ""
        content.sound = .default
        let request = UNNotificationRequest(identifier: "download-complete-\(editionId)", content: content, trigger: nil)
        Task { try? await UNUserNotificationCenter.current().add(request) }
    }

    private func verifiedFileCount(in plan: DownloadPlan) -> Int {
        plan.files.reduce(into: 0) { count, file in
            if plan.states[file.id] == .verified {
                count += 1
            }
        }
    }
}
