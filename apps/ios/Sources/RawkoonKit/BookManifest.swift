import Foundation

/// One chapter, as the server describes it.
///
/// `startSecs`/`endSecs` are offsets on the WHOLE-BOOK timeline, produced by
/// accumulating the probed durations of the files on disk. They are not the
/// source chapter atoms, which drift by about a frame per chapter.
public struct ManifestChapter: Codable, Equatable, Sendable {
    public let index: Int
    public let title: String
    public let startSecs: Double
    public let endSecs: Double
    public let fileId: Int
    public let sizeBytes: Int
    /// Null until the server computes hashes; the client must tolerate that.
    public let sha256: String?
    public let url: String

    public var durationSecs: Double {
        endSecs - startSecs
    }
}

public struct BookManifest: Codable, Equatable, Sendable {
    public let editionId: Int
    public let bookId: Int
    public let title: String
    public let authors: [String]
    public let totalDurationSecs: Double
    public let chapters: [ManifestChapter]
}
