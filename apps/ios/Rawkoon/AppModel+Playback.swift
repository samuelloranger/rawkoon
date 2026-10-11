import Foundation
import RawkoonKit

extension AppModel {
    /// The book currently loaded in the player, if any — drives the persistent
    /// mini-player and its expand-to-full-player sheet. Non-nil once
    /// `openPlayer(editionId:)` has run (it caches the manifest and sets
    /// `activeEditionId`).
    func activeBook() -> (summary: LibrarySummary, manifest: BookManifest)? {
        guard
            let id = activeEditionId,
            let summary = library.first(where: { $0.audiobookEditionId == id })?.audiobookSummary,
            let manifest = manifests[id]
        else {
            return nil
        }
        return (summary, manifest)
    }

    func cachedManifest(_ editionId: Int) -> BookManifest? {
        if let cached = manifests[editionId] {
            return cached
        }
        if let disk = DownloadedStore.readManifest(editionId: editionId) {
            manifests[editionId] = disk
            return disk
        }
        return nil
    }

    func manifest(_ editionId: Int, forceRefresh: Bool = false) async throws -> BookManifest {
        if !forceRefresh, let cached = manifests[editionId] {
            return cached
        }
        if !forceRefresh, let disk = DownloadedStore.readManifest(editionId: editionId) {
            manifests[editionId] = disk
            return disk
        }
        guard let apiClient else {
            // Logged out or no client: a downloaded book still opens from its
            // persisted manifest rather than failing.
            if let disk = DownloadedStore.readManifest(editionId: editionId) {
                manifests[editionId] = disk
                return disk
            }
            throw APIError.unauthorized
        }

        do {
            let fetched = try await apiClient.manifest(editionId: editionId)
            manifests[editionId] = fetched
            dropStaleDownload(editionId: editionId, fresh: fetched)
            // Backfill a pre-existing, fully-downloaded audiobook (downloaded
            // before offline persistence shipped) the first time it is opened
            // online, so it too becomes usable offline.
            if !isIndexedAsDownloaded(editionId),
               !fetched.files.isEmpty,
               DownloadPlan.restored(
                   files: fetched.files,
                   existingBytes: Self.onDiskBytes(editionId: editionId, files: fetched.files)
               ).isComplete
            {
                persistDownloadedAudiobook(editionId: editionId)
            }
            return fetched
        } catch {
            // Offline / server unreachable: fall back to the downloaded copy so
            // playback works with no network. Re-throw only when nothing is
            // cached on disk.
            if let disk = DownloadedStore.readManifest(editionId: editionId) {
                manifests[editionId] = disk
                return disk
            }
            throw error
        }
    }

    func openPlayer(editionId: Int, resumeAt overridePosition: Double? = nil) async {
        errorMessage = nil

        // Reloading the book already playing would pause it and rewind it to a
        // stale snapshot, so only an explicitly chosen position moves it.
        if editionId == activeEditionId, player.manifest?.editionId == editionId, player.playbackError == nil {
            if let overridePosition {
                player.seek(to: overridePosition)
            }
            return
        }

        do {
            let manifest = try await manifest(editionId)
            guard let baseURL = URL(string: serverURL) else {
                errorMessage = String(localized: "Enter a valid server URL.")
                return
            }

            let resumeAt: Double = if let overridePosition {
                max(0, min(overridePosition, manifest.totalDurationSecs))
            } else {
                await resolveResumePosition(editionId: editionId, manifest: manifest)
            }
            persistPlaybackProgress(force: true)
            activeEditionId = editionId
            player.load(
                manifest: manifest,
                baseURL: baseURL,
                resumeAt: resumeAt,
                artworkURL: library
                    .first(where: { $0.audiobookEditionId == editionId })?
                    .audiobookSummary?.coverURL
            )
            // The manifest may be a cached copy whose signed URLs expired after
            // seven days; refresh them behind playback for any chapter that streams.
            Task { [weak self] in
                guard let fresh = await self?.refreshedManifest(editionId: editionId) else { return }
                self?.player.adoptRefreshedManifest(fresh)
            }
        } catch {
            errorMessage = message(for: error)
        }
    }

    /// Freshly signed URLs for the same files, or nil offline, on failure, or
    /// when the server re-imported the book. The downloaded copy on disk is
    /// rewritten too, so the next cold start has live URLs.
    func refreshedManifest(editionId: Int) async -> BookManifest? {
        guard isOnline, let apiClient else { return nil }
        do {
            let fresh = try await apiClient.manifest(editionId: editionId)
            // URLs only: a re-import is left to `manifest()`'s stale-download
            // handling, never deleted from under a book that is playing.
            guard let current = manifests[editionId] ?? DownloadedStore.readManifest(editionId: editionId),
                  sameFileLayout(current.files, fresh.files)
            else { return nil }
            manifests[editionId] = fresh
            if DownloadedStore.readManifest(editionId: editionId) != nil {
                DownloadedStore.writeManifest(fresh, editionId: editionId)
            }
            return fresh
        } catch {
            Log.playback.error(
                """
                Manifest refresh failed: \
                editionId=\(editionId, privacy: .public) \
                error=\(error.localizedDescription, privacy: .public)
                """
            )
            return nil
        }
    }

    /// Closes the player: stops audio, drops Now Playing, hides the mini bar.
    func closePlayer() {
        persistPlaybackProgress(force: true)
        activeEditionId = nil
        player.unload()
    }

    /// Deletes local chapters a re-import on the server replaced, and takes the
    /// book off the offline list until it is downloaded again. Skipped while a
    /// download is running, since that one already works from the fresh manifest.
    private func dropStaleDownload(editionId: Int, fresh: BookManifest) {
        guard downloaders[editionId] == nil,
              let persisted = DownloadedStore.readManifest(editionId: editionId)
        else { return }
        let stale = staleLocalFiles(persisted: persisted.files, fresh: fresh.files)
        guard !stale.isEmpty else { return }
        for file in stale {
            FileStore.delete(url: FileStore.chapterURL(editionId: editionId, fileId: file.id, ext: file.fileExtension))
        }
        DownloadedStore.forget(editionId: editionId)
        DownloadedStore.writeManifest(fresh, editionId: editionId)
        downloadPlans.removeValue(forKey: editionId)
        verifiedCounts.removeValue(forKey: editionId)
        chapterFractions.removeValue(forKey: editionId)
        downloadFractions.removeValue(forKey: editionId)
    }

    /// Size of each chapter already on disk, keyed by file id.
    static func onDiskBytes(editionId: Int, files: [ManifestFile]) -> [Int: Int] {
        var existingBytes: [Int: Int] = [:]
        for file in files {
            let ext = file.fileExtension
            guard FileStore.exists(editionId: editionId, fileId: file.id, ext: ext) else { continue }
            let url = FileStore.chapterURL(editionId: editionId, fileId: file.id, ext: ext)
            if let bytes = FileStore.size(url: url) {
                existingBytes[file.id] = bytes
            }
        }
        return existingBytes
    }

    /// The index, not manifest.json, marks a finished download: the manifest is
    /// written when a download starts.
    func isIndexedAsDownloaded(_ editionId: Int) -> Bool {
        DownloadedStore.readIndex().contains { $0.editionId == editionId && $0.kind == .audiobook }
    }
}
