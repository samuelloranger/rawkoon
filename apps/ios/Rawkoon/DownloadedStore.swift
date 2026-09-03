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

    /// The downloaded-editions index, or an empty list when it is missing or
    /// unreadable — a corrupt index must never crash the offline library.
    static func readIndex() -> [DownloadedEdition] {
        guard let data = try? Data(contentsOf: indexURL) else { return [] }
        return (try? JSONDecoder().decode([DownloadedEdition].self, from: data)) ?? []
    }

    static func upsert(_ entry: DownloadedEdition) {
        writeIndex(DownloadedLibrary.upsert(readIndex(), entry))
    }

    static func remove(editionId: Int) {
        writeIndex(DownloadedLibrary.remove(readIndex(), editionId: editionId))
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
        guard let data = try? Data(contentsOf: manifestURL(editionId)) else { return nil }
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
        guard let data = try? Data(contentsOf: ebookFilesURL(editionId)) else { return nil }
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

    // MARK: Completeness

    /// Number of downloaded content files under an edition's directory, ignoring
    /// the metadata files this store writes. Used to detect a pre-existing,
    /// fully-downloaded audiobook (from before offline persistence shipped) so it
    /// can be backfilled into the index on its first online open.
    static func downloadedFileCount(editionId: Int) -> Int {
        let directory = editionDirectory(editionId)
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else {
            return 0
        }
        let metadata: Set = ["manifest.json", "ebook-files.json"]
        return names.filter { !metadata.contains($0) && !$0.hasPrefix("cover") }.count
    }

    // MARK: Teardown

    /// Drops an edition from the index. The edition's directory (manifest,
    /// cover, chapter files) is removed by `FileStore.deleteEdition`.
    static func forget(editionId: Int) {
        remove(editionId: editionId)
    }
}
