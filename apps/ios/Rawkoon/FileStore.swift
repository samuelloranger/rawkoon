import Foundation

enum FileStore {
    static func chapterURL(editionId: Int, fileId: Int, ext: String) -> URL {
        let directory = editionDirectory(editionId)
        createDirectoryIfNeeded(directory)

        let cleanExt = ext.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let filename = cleanExt.isEmpty ? "\(fileId)" : "\(fileId).\(cleanExt)"
        return directory.appendingPathComponent(filename, isDirectory: false)
    }

    /// Where an EPUB is unpacked for reading.
    ///
    /// Keyed by file id, not edition id: the extracted tree is derived data for
    /// one archive, and deleting an edition's downloads must not strand it.
    static func epubExtractionURL(fileId: Int) -> URL {
        let directory = applicationSupportDirectory()
            .appendingPathComponent("EpubExtracted", isDirectory: true)
            .appendingPathComponent(String(fileId), isDirectory: true)
        createDirectoryIfNeeded(directory)
        return directory
    }

    static func exists(editionId: Int, fileId: Int, ext: String) -> Bool {
        let url = chapterURL(editionId: editionId, fileId: fileId, ext: ext)
        return FileManager.default.fileExists(atPath: url.path)
    }

    static func size(url: URL) -> Int? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let value = attributes[.size] as? NSNumber else {
            return nil
        }
        return value.intValue
    }

    static func deleteEdition(_ editionId: Int) {
        let directory = editionDirectory(editionId)
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        try? FileManager.default.removeItem(at: directory)
    }

    static func excludeFromBackup(_ url: inout URL) {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    /// The root of the app's book storage — downloads, extracted EPUBs and the
    /// reading-progress file all live under it.
    static func booksDirectory() -> URL {
        applicationSupportDirectory()
    }

    private static func applicationSupportDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let books = base.appendingPathComponent("Books", isDirectory: true)
        createDirectoryIfNeeded(books)
        return books
    }

    private static func editionDirectory(_ editionId: Int) -> URL {
        applicationSupportDirectory().appendingPathComponent(String(editionId), isDirectory: true)
    }

    private static func createDirectoryIfNeeded(_ url: URL) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}
