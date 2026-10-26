import Foundation

/// Maps between the whole-book timeline and a Cast receiver's queue, which
/// holds one item per manifest file in manifest order.
public enum CastQueuePlan {
    /// Where a receiver queue starts for a whole-book position: the file that
    /// holds it, and the offset inside that file.
    public struct Start: Equatable, Sendable {
        public let index: Int
        public let offset: Double
    }

    /// Nil for a book with no files. A position before the first file starts
    /// on it, and one past the end sits at the end of the last file.
    public static func start(files: [ManifestFile], at position: Double) -> Start? {
        guard !files.isEmpty else { return nil }
        let index = files.lastIndex(where: { $0.startSecs <= position }) ?? 0
        let file = files[index]
        let offset = min(max(position - file.startSecs, 0), max(file.durationSecs, 0))
        return Start(index: index, offset: offset)
    }

    /// The whole-book position for the receiver's offset inside `file`. The
    /// receiver can report a little past the file's probed length, so it is clamped.
    public static func wholeBookPosition(file: ManifestFile, streamPosition: Double) -> Double {
        guard streamPosition.isFinite else { return file.startSecs }
        return file.startSecs + min(max(streamPosition, 0), max(file.durationSecs, 0))
    }

    /// The receiver plays whatever the server sends, but it picks its player from
    /// this type. Extensionless grant URLs leave nothing to guess from, so a
    /// manifest without the field falls back to MP3, the server's own default.
    public static func contentType(for file: ManifestFile) -> String {
        file.mimeType ?? "audio/mpeg"
    }
}
