import Foundation

enum FileStore {
    static func chapterURL(editionId: Int, fileId: Int, ext: String) -> URL {
        let directory = editionDirectory(editionId)
        createDirectoryIfNeeded(directory)

        let cleanExt = ext.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let filename = cleanExt.isEmpty ? "\(fileId)" : "\(fileId).\(cleanExt)"
        return directory.appendingPathComponent(filename, isDirectory: false)
    }

    static func exists(editionId: Int, fileId: Int, ext: String) -> Bool {
        let url = chapterURL(editionId: editionId, fileId: fileId, ext: ext)
        return FileManager.default.fileExists(atPath: url.path)
    }

    // Best-effort: the return type is already optional, and every caller
    // coalesces a missing or unreadable file to nil — there is no separate
    // failure state left to report.
    static func size(url: URL) -> Int? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let value = attributes[.size] as? NSNumber
        else {
            return nil
        }
        return value.intValue
    }

    /// Removing a file that may already be gone. A missing file is a no-op,
    /// not an error; any other failure is logged for diagnosis.
    static func delete(url: URL) {
        do {
            try FileManager.default.removeItem(at: url)
        } catch CocoaError.fileNoSuchFile {
            // Not present — treat delete as a no-op.
        } catch {
            Log.download.error("Failed to remove file at \(url.lastPathComponent, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    static func deleteEdition(_ editionId: Int) {
        let directory = editionDirectory(editionId)
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        do {
            try FileManager.default.removeItem(at: directory)
        } catch {
            Log.download.error(
                """
                Failed to delete edition directory: \
                editionId=\(editionId, privacy: .public) \
                error=\(error.localizedDescription, privacy: .public)
                """
            )
        }
    }

    /// This only flags a directory for iCloud-backup exclusion. A failure
    /// inflates backup size; it never affects playback or download
    /// correctness, but is logged so it can be diagnosed.
    static func excludeFromBackup(_ url: inout URL) {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        do {
            try url.setResourceValues(values)
        } catch {
            let name = url.lastPathComponent
            Log.download.error("Failed to set resource values (exclude-from-backup) on \(name, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The root of the app's book storage — downloads and the reading-progress
    /// file live under it.
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
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        } catch {
            Log.download.error(
                """
                Failed to create directory: \
                error=\(error.localizedDescription, privacy: .public)
                """
            )
        }
    }
}
