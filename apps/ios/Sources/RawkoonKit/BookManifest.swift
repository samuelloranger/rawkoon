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

    /// Filename suffix for the on-disk chapter. Grant URLs have no extension,
    /// so those land as `.bin` — same rule the downloader and player use.
    public var fileExtension: String {
        let ext = URL(string: url)?.pathExtension ?? ""
        return ext.isEmpty ? "bin" : ext
    }
}

/// One physical file of a book: the unit of download and of playback. A
/// multi-file book has one file per chapter; a single-file audiobook has one
/// file that many chapters index into. `startSecs` is the whole-book position
/// of the file's t=0.
public struct ManifestFile: Codable, Equatable, Sendable {
    public let id: Int
    public let startSecs: Double
    public let durationSecs: Double
    public let sizeBytes: Int
    public let sha256: String?
    public let url: String

    public init(id: Int, startSecs: Double, durationSecs: Double,
                sizeBytes: Int, sha256: String?, url: String) {
        self.id = id
        self.startSecs = startSecs
        self.durationSecs = durationSecs
        self.sizeBytes = sizeBytes
        self.sha256 = sha256
        self.url = url
    }

    /// Same rule as `ManifestChapter.fileExtension`: grant URLs have no
    /// extension, so those land as `.bin`.
    public var fileExtension: String {
        let ext = URL(string: url)?.pathExtension ?? ""
        return ext.isEmpty ? "bin" : ext
    }
}

public struct BookManifest: Codable, Equatable, Sendable {
    public let editionId: Int
    public let bookId: Int
    public let title: String
    public let authors: [String]
    public let totalDurationSecs: Double
    public let files: [ManifestFile]
    public let chapters: [ManifestChapter]

    public init(editionId: Int, bookId: Int, title: String, authors: [String],
                totalDurationSecs: Double, files: [ManifestFile],
                chapters: [ManifestChapter]) {
        self.editionId = editionId
        self.bookId = bookId
        self.title = title
        self.authors = authors
        self.totalDurationSecs = totalDurationSecs
        self.files = files
        self.chapters = chapters
    }

    private enum CodingKeys: String, CodingKey {
        case editionId, bookId, title, authors, totalDurationSecs, files, chapters
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        editionId = try c.decode(Int.self, forKey: .editionId)
        bookId = try c.decode(Int.self, forKey: .bookId)
        title = try c.decode(String.self, forKey: .title)
        authors = try c.decode([String].self, forKey: .authors)
        totalDurationSecs = try c.decode(Double.self, forKey: .totalDurationSecs)
        chapters = try c.decode([ManifestChapter].self, forKey: .chapters)
        let decoded = try c.decodeIfPresent([ManifestFile].self, forKey: .files) ?? []
        files = decoded.isEmpty ? BookManifest.synthesizeFiles(from: chapters) : decoded
    }

    /// Legacy fallback: before `files` existed, each chapter WAS its own file.
    public static func synthesizeFiles(from chapters: [ManifestChapter]) -> [ManifestFile] {
        chapters.map {
            ManifestFile(
                id: $0.fileId,
                startSecs: $0.startSecs,
                durationSecs: max($0.endSecs - $0.startSecs, 0),
                sizeBytes: $0.sizeBytes,
                sha256: $0.sha256,
                url: $0.url
            )
        }
    }

    /// On-disk manifests are camelCase (`JSONEncoder` default). The live
    /// server payload is snake_case. Accept either so a cold start can list
    /// chapters without waiting on the network.
    public static func decodePersisted(_ data: Data) -> BookManifest? {
        if let decoded = try? JSONDecoder().decode(BookManifest.self, from: data) {
            return decoded
        }
        let snake = JSONDecoder()
        snake.keyDecodingStrategy = .convertFromSnakeCase
        return try? snake.decode(BookManifest.self, from: data)
    }
}
