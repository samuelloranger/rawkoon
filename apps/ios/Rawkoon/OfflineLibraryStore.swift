import Foundation
import RawkoonKit

/// Stateless persistence of downloaded editions into the offline store: writes
/// the manifest/file-list and index record, and best-effort caches the cover.
/// Split out of `AppModel` so that class holds live state, not disk bookkeeping.
/// Every method is a pure function of its inputs plus `DownloadedStore` — it
/// owns no `AppModel` state, so `AppModel` keeps thin forwarders and passes the
/// manifest/book it already has.
@MainActor
enum OfflineLibraryStore {
    /// Snapshots a completed audiobook into the offline store: its manifest, an
    /// index record, and a cached cover (best-effort).
    static func persistAudiobook(editionId: Int, manifest: BookManifest, book: BookListItem?) {
        DownloadedStore.writeManifest(manifest, editionId: editionId)

        let entry = DownloadedEdition(
            editionId: editionId,
            bookId: manifest.bookId,
            kind: .audiobook,
            title: book?.title ?? manifest.title,
            author: book?.author ?? manifest.authors.first,
            totalDurationSecs: manifest.totalDurationSecs,
            fileCount: manifest.files.count,
            coverFileName: nil,
            addedAtMillis: Int64(Date().timeIntervalSince1970 * 1000)
        )
        DownloadedStore.upsert(entry)

        if let coverURL = book?.coverURL {
            Task { await cacheCover(from: coverURL, editionId: editionId) }
        }
    }

    /// Records a downloaded ebook into the offline store: its file list (so the
    /// Book screen can offer Read offline), an index record, and a cached cover.
    /// `editionId` is the storage id the on-disk file uses.
    static func recordEbookDownloaded(
        editionId: Int,
        bookId: Int,
        title: String,
        author: String?,
        coverURL: URL?,
        files: [BookEditionFile],
        downloadedFileCount: Int
    ) {
        DownloadedStore.writeEbookFiles(files, editionId: editionId)
        let entry = DownloadedEdition(
            editionId: editionId,
            bookId: bookId,
            kind: .ebook,
            title: title,
            author: author,
            totalDurationSecs: nil,
            fileCount: max(downloadedFileCount, 1),
            coverFileName: nil,
            addedAtMillis: Int64(Date().timeIntervalSince1970 * 1000)
        )
        DownloadedStore.upsert(entry)
        if let coverURL {
            Task { await cacheCover(from: coverURL, editionId: editionId) }
        }
    }

    /// The persisted ebook file list for a downloaded edition, or nil. The Book
    /// screen falls back to this when the server is unreachable.
    static func ebookFiles(editionId: Int) -> [BookEditionFile]? {
        DownloadedStore.readEbookFiles(editionId: editionId)
    }

    /// Caches covers for downloaded editions that have none, e.g. a download
    /// that finished during a background launch, before the library had loaded.
    static func backfillMissingCovers(library: [BookListItem]) {
        for entry in DownloadedStore.readIndex() where entry.coverFileName == nil {
            let book = library.first {
                $0.audiobookEditionId == entry.editionId || $0.ebookEditionId == entry.editionId
            }
            guard let coverURL = book?.coverURL else { continue }
            Task { await cacheCover(from: coverURL, editionId: entry.editionId) }
        }
    }

    /// Best-effort cover download for the offline list. Failure is silent — the
    /// row renders without art.
    private static func cacheCover(from url: URL, editionId: Int) async {
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return }
        let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
        guard let fileName = DownloadedStore.writeCover(data, editionId: editionId, ext: ext) else { return }
        // Re-read/patch the index so the record points at the saved cover.
        let patched = DownloadedStore.readIndex().map { entry -> DownloadedEdition in
            guard entry.editionId == editionId else { return entry }
            return DownloadedEdition(
                editionId: entry.editionId, bookId: entry.bookId, kind: entry.kind,
                title: entry.title, author: entry.author,
                totalDurationSecs: entry.totalDurationSecs, fileCount: entry.fileCount,
                coverFileName: fileName, addedAtMillis: entry.addedAtMillis
            )
        }
        for entry in patched where entry.editionId == editionId {
            DownloadedStore.upsert(entry)
        }
    }
}
