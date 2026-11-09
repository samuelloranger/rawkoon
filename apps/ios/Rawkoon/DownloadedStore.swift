import Foundation
import RawkoonKit

/// On-disk persistence for the offline library: the downloaded-editions index,
/// each downloaded audiobook's manifest, and cached cover art. The pure
/// decisions (dedup/order/membership) live in `RawkoonKit.DownloadedLibrary`;
/// this type is only the file IO around them.
///
/// Layout, all under `FileStore.booksDirectory()`:
/// - `downloaded-index.json`           — `[DownloadedEdition]`
/// - `<editionId>/manifest.json`       — the audiobook `BookManifest`
/// - `<editionId>/<coverFileName>`     — cached cover image
///
/// Not MainActor: like `FileStore`, every call is self-contained with no shared
/// mutable state, and it is invoked from download-completion callbacks that run
/// off the main actor.
nonisolated enum DownloadedStore {
    private static var indexURL: URL {
        FileStore.booksDirectory().appendingPathComponent("downloaded-index.json", isDirectory: false)
    }

    private static func editionDirectory(_ editionId: Int) -> URL {
        FileStore.booksDirectory().appendingPathComponent(String(editionId), isDirectory: true)
    }

    private static func manifestURL(_ editionId: Int) -> URL {
        editionDirectory(editionId).appendingPathComponent("manifest.json", isDirectory: false)
    }

    private static func ebookFilesURL(_ editionId: Int) -> URL {
        editionDirectory(editionId).appendingPathComponent("ebook-files.json", isDirectory: false)
    }

    // MARK: Index

    private static var activeKey: String? {
        ActiveServerKey.shared.value
    }

    /// The active server's downloaded editions (plus unstamped legacy ones), or an empty
    /// list when the index is missing or unreadable — a corrupt index must never crash
    /// the offline library. Another server's records stay on disk, just hidden.
    static func readIndex() -> [DownloadedEdition] {
        DownloadedLibrary.visible(readRawIndex(), serverKey: activeKey)
    }

    private static func readRawIndex() -> [DownloadedEdition] {
        guard let data = try? Data(contentsOf: indexURL) else { return [] }
        return (try? JSONDecoder().decode([DownloadedEdition].self, from: data)) ?? []
    }

    static func upsert(_ entry: DownloadedEdition) {
        writeIndex(DownloadedLibrary.upsert(readRawIndex(), entry.with(serverKey: activeKey)))
    }

    static func remove(editionId: Int) {
        writeIndex(DownloadedLibrary.remove(readRawIndex(), editionId: editionId, serverKey: activeKey))
    }

    /// The edition's files on disk belong to another server's download.
    static func isForeign(editionId: Int) -> Bool {
        DownloadedLibrary.isForeign(readRawIndex(), editionId: editionId, serverKey: activeKey)
    }

    /// A download of this edition id would reuse the other server's files (same path), so
    /// they are dropped before it starts; the files cannot hold two servers' copies.
    static func evictForeign(editionId: Int) {
        guard isForeign(editionId: editionId) else { return }
        FileStore.deleteChapters(editionId: editionId, keeping: [])
        writeIndex(readRawIndex().filter { $0.editionId != editionId })
    }

    /// Stamps entries from before servers were told apart with the first identity that signs in.
    static func adoptLegacy(serverKey: String) {
        let index = readRawIndex()
        let adopted = DownloadedLibrary.adopting(index, serverKey: serverKey)
        if adopted != index {
            writeIndex(adopted)
        }
    }

    private static func writeIndex(_ index: [DownloadedEdition]) {
        guard let data = try? JSONEncoder().encode(index) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    // MARK: Manifest

    static func writeManifest(_ manifest: BookManifest, editionId: Int) {
        let directory = editionDirectory(editionId)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(manifest) else { return }
        try? data.write(to: manifestURL(editionId), options: .atomic)
    }

    /// The persisted manifest for a downloaded audiobook, or nil when the book
    /// was never downloaded — the caller falls back to the network.
    static func readManifest(editionId: Int) -> BookManifest? {
        guard !isForeign(editionId: editionId),
              let data = try? Data(contentsOf: manifestURL(editionId)) else { return nil }
        return BookManifest.decodePersisted(data)
    }

    // MARK: Ebook file list

    /// Persists the ebook edition's file list so the Book screen can show the
    /// "Read" affordance for a downloaded ebook with no network. Keyed by the
    /// same storage id the on-disk ebook file uses.
    static func writeEbookFiles(_ files: [BookEditionFile], editionId: Int) {
        let directory = editionDirectory(editionId)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(files) else { return }
        try? data.write(to: ebookFilesURL(editionId), options: .atomic)
    }

    static func readEbookFiles(editionId: Int) -> [BookEditionFile]? {
        guard !isForeign(editionId: editionId),
              let data = try? Data(contentsOf: ebookFilesURL(editionId)) else { return nil }
        return try? JSONDecoder().decode([BookEditionFile].self, from: data)
    }

    // MARK: Cover

    /// Saves cover image bytes next to the edition's files and returns the file
    /// name to record in the index, or nil if the write failed (the row still
    /// renders without a cover).
    static func writeCover(_ data: Data, editionId: Int, ext: String) -> String? {
        let directory = editionDirectory(editionId)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let cleanExt = ext.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        let fileName = cleanExt.isEmpty ? "cover" : "cover.\(cleanExt)"
        let url = directory.appendingPathComponent(fileName, isDirectory: false)
        guard (try? data.write(to: url, options: .atomic)) != nil else { return nil }
        return fileName
    }

    static func coverURL(editionId: Int, fileName: String?) -> URL? {
        guard let fileName else { return nil }
        let url = editionDirectory(editionId).appendingPathComponent(fileName, isDirectory: false)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    // MARK: Teardown

    /// Drops an edition from the index. The edition's directory (manifest,
    /// cover, chapter files) is removed by `FileStore.deleteEdition`.
    static func forget(editionId: Int) {
        remove(editionId: editionId)
    }
}
