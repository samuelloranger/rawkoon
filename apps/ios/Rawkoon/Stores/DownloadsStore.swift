import Foundation
import Observation
import RawkoonKit

/// Owns audiobook downloads: the per-edition plans and live downloaders, the
/// cached manifests, the downloaded-book index mirror, background URLSession
/// hand-off and the offline prefetch. Session, library and toasts come from the
/// stores passed to `init`; the network path and the playing edition are hooks
/// `AppModel.init` wires, so the store holds no back-reference to the model.
@MainActor
@Observable
final class DownloadsStore {
    var downloadPlans: [Int: DownloadPlan] = [:]
    /// Books with any fully downloaded edition (audiobook or ebook), mirrored
    /// from the on-disk index so the book list order can react to it.
    private(set) var downloadedBookIds: Set<Int> = []
    var manifests: [Int: BookManifest] = [:]
    var downloaders: [Int: ChapterDownloader] = [:]
    var pendingBackgroundCompletions: [String: () -> Void] = [:]
    var verifiedCounts: [Int: Int] = [:]
    /// The server key in force when each edition's download started; the index entry is stamped with it.
    var downloadServerKeys: [Int: String] = [:]
    /// Live in-flight chapter fractions per edition, for the chapter pills and the overall bar.
    var chapterFractions: [Int: [Int: Double]] = [:]
    /// Smooth, never-decreasing overall fraction per edition while it downloads.
    var downloadFractions: [Int: Double] = [:]
    /// Editions whose grants are being refetched, and how often — a server whose
    /// secret rotated would otherwise refetch forever.
    var grantRefreshAttempts: [Int: Int] = [:]
    var startingDownloads: Set<Int> = []
    var invalidatingSessions: Set<Int> = []
    var grantRefreshInFlight: Set<Int> = []
    var prefetchTask: Task<Void, Never>?

    // MARK: Hooks wired by AppModel.init

    /// Whether the device currently has a usable network path.
    var isOnline: () -> Bool = { true }
    /// Cellular, a personal hotspot, or Low Data Mode: background prefetching waits.
    var isOnExpensiveNetwork: () -> Bool = { false }
    /// The edition loaded in the player: its manifest is kept and the player rebuilt when it is purged.
    var activeEditionId: () -> Int? = { nil }
    var rebuildPlayer: () -> Void = {}

    let session: SessionStore
    let libraryStore: LibraryStore
    let router: UIRouter

    init(session: SessionStore, libraryStore: LibraryStore, router: UIRouter) {
        self.session = session
        self.libraryStore = libraryStore
        self.router = router
    }

    func refreshDownloadedBookIds() {
        downloadedBookIds = Set(DownloadedStore.readIndex().map(\.bookId))
    }

    /// The download half of sign-out: cancels every downloader (the session id stays
    /// reserved until its invalidation lands) and forgets plans, manifests and server keys.
    func reset() {
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
        for editionId in editionIds where !DownloadedStore.isForeign(editionId: editionId) {
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
        session.errorMessage = nil
        // The manifest await below is a window where a second call (a re-tap, a
        // background relaunch) would build a second downloader on the same session id.
        guard !startingDownloads.contains(editionId) else { return }
        startingDownloads.insert(editionId)
        defer { startingDownloads.remove(editionId) }
        // Same path as another server's copy of this edition id: the files cannot be shared.
        DownloadedStore.evictForeign(editionId: editionId)
        // The completion may land after the session changed (or before the key is readable).
        downloadServerKeys[editionId] = ActiveServerKey.shared.value
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
            guard let baseURL = URL(string: session.serverURL) else {
                session.errorMessage = String(localized: "Enter a valid server URL.")
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
            session.errorMessage = session.describeError(error)
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
        Task {
            await startDownload(editionId: editionId, preferDiskManifest: true)
            // startDownload can return early (bad URL, no manifest) without attaching a
            // downloader; iOS needs the handler called or it throttles the next wake.
            pendingBackgroundCompletions.removeValue(forKey: identifier)?()
        }
    }

    /// Recovers chapters whose completion never arrived; see `ChapterDownloader.resync`.
    func resyncDownloads() {
        for downloader in downloaders.values {
            downloader.resync()
        }
    }
}
