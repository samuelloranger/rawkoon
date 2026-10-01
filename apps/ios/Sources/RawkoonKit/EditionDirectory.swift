import Foundation

public enum EditionDirectory {
    /// Removes a downloaded edition's directory and reports whether it is gone.
    ///
    /// The markers (the manifest a launch restores a plan from) go first, so a
    /// delete that fails partway cannot bring the download back on relaunch.
    public static func remove(
        _ directory: URL,
        markers: [String],
        fileManager: FileManager = .default,
        removeItem: (URL) throws -> Void = { try FileManager.default.removeItem(at: $0) }
    ) -> Bool {
        guard fileManager.fileExists(atPath: directory.path) else { return true }
        for marker in markers {
            try? removeItem(directory.appendingPathComponent(marker, isDirectory: false))
        }
        // A second try covers a transfer that was still closing its file the first time.
        for _ in 0 ..< 2 {
            try? removeItem(directory)
            if !fileManager.fileExists(atPath: directory.path) {
                return true
            }
        }
        return false
    }
}
