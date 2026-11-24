import Foundation
import RawkoonKit

extension DownloadsStore {
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
        guard let apiClient = session.apiClient else {
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

    /// Freshly signed URLs for the same files, or nil offline, on failure, or
    /// when the server re-imported the book. The downloaded copy on disk is
    /// rewritten too, so the next cold start has live URLs.
    func refreshedManifest(editionId: Int) async -> BookManifest? {
        guard isOnline(), let apiClient = session.apiClient else { return nil }
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

    /// Snapshots a freshly-completed audiobook into the offline store — see
    /// `OfflineLibraryStore.persistAudiobook`. Reads the manifest and book this
    /// model already holds and hands them off.
    func persistDownloadedAudiobook(editionId: Int) {
        guard let manifest = manifests[editionId] else { return }
        let book = libraryStore.library.first { $0.audiobookEditionId == editionId }
        OfflineLibraryStore.persistAudiobook(
            editionId: editionId, manifest: manifest, book: book, serverKey: downloadServerKeys[editionId]
        )
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
        downloadedFileCount: Int,
        serverKey: String?
    ) {
        OfflineLibraryStore.recordEbookDownloaded(
            editionId: editionId, bookId: bookId, title: title, author: author,
            coverURL: coverURL, files: files, downloadedFileCount: downloadedFileCount, serverKey: serverKey
        )
        refreshDownloadedBookIds()
    }

    /// The persisted ebook file list for a downloaded edition, or nil — see
    /// `OfflineLibraryStore.ebookFiles`. The Book screen falls back to this when
    /// the server is unreachable.
    func offlineEbookFiles(editionId: Int) -> [BookEditionFile]? {
        OfflineLibraryStore.ebookFiles(editionId: editionId)
    }
}
