import Foundation

/// Where a reader left off in an ebook edition.
///
/// A spine index alone is not enough to resume: a re-download can reorder or
/// re-slice the spine, and the same index would then open a different chapter.
/// The path is carried so the index can be re-derived — see
/// `ReadingProgressReconciler.resolve(_:spine:)`.
public struct ReadingPosition: Codable, Equatable, Sendable {
    public let editionId: Int
    /// Which file this was recorded against; an edition can hold several formats.
    public let fileId: Int?
    public let spineIndex: Int
    /// Path of the spine document inside the archive.
    public let spinePath: String
    public let spineCount: Int
    /// 0–1 scroll offset within the spine document.
    public let scrollFraction: Double
    public let finished: Bool
    public let updatedAtMillis: Int64
    /// Serialised Readium Locator JSON. Stored as a string so this package
    /// never imports Readium (Linux CI cannot see that toolkit).
    public let locator: String?

    public init(
        editionId: Int,
        fileId: Int?,
        spineIndex: Int,
        spinePath: String,
        spineCount: Int,
        scrollFraction: Double,
        finished: Bool = false,
        updatedAtMillis: Int64,
        locator: String? = nil
    ) {
        self.editionId = editionId
        self.fileId = fileId
        self.spineIndex = spineIndex
        self.spinePath = spinePath
        self.spineCount = spineCount
        self.scrollFraction = min(max(scrollFraction, 0), 1)
        self.finished = finished
        self.updatedAtMillis = updatedAtMillis
        self.locator = locator
    }
}

public enum ReadingProgressReconciler {
    /// Same rule as the audiobook path and the server: newest write wins, ties
    /// keep the local copy so two devices cannot flip a position forever.
    public static func reconcile(
        local: ReadingPosition?,
        remote: ReadingPosition?
    ) -> SyncOutcome {
        switch (local, remote) {
        case (nil, nil):
            return .keepLocal
        case (nil, .some):
            return .takeRemote
        case (.some, nil):
            return .push
        case let (.some(l), .some(r)):
            if r.updatedAtMillis > l.updatedAtMillis { return .takeRemote }
            if l.updatedAtMillis > r.updatedAtMillis { return .push }
            return .keepLocal
        }
    }

    /// Re-point a stored position at the spine actually on disk.
    ///
    /// The stored path is authoritative: if it moved, follow it. If it is gone
    /// the position is only approximate, so the index is clamped and the scroll
    /// offset dropped rather than applied to an unrelated chapter.
    public static func resolve(
        _ position: ReadingPosition,
        spine: [String]
    ) -> (index: Int, scrollFraction: Double) {
        guard !spine.isEmpty else { return (0, 0) }

        if position.spineIndex >= 0,
           position.spineIndex < spine.count,
           spine[position.spineIndex] == position.spinePath
        {
            return (position.spineIndex, position.scrollFraction)
        }

        if let moved = spine.firstIndex(of: position.spinePath) {
            return (moved, position.scrollFraction)
        }

        return (min(max(position.spineIndex, 0), spine.count - 1), 0)
    }
}

/// Per-edition reading positions, persisted as one small JSON file.
///
/// Not the append-only journal the audiobook player uses: that exists because
/// playback advances continuously and a crash mid-chapter must not lose minutes.
/// A reading position changes only when the reader moves, so a whole-file
/// rewrite is cheap and leaves nothing to compact.
public struct ReadingProgressStore: Sendable {
    private let fileURL: URL

    public init(directory: URL, fileName: String = "reading-progress.json") {
        fileURL = directory.appendingPathComponent(fileName, isDirectory: false)
    }

    public func all() -> [Int: ReadingPosition] {
        guard let data = try? Data(contentsOf: fileURL) else { return [:] }
        // A corrupt or half-written file must not make the reader unusable —
        // losing a bookmark is recoverable, refusing to open the book is not.
        guard let decoded = try? JSONDecoder().decode([String: ReadingPosition].self, from: data)
        else {
            return [:]
        }
        return Dictionary(
            uniqueKeysWithValues: decoded.compactMap { key, value in
                Int(key).map { ($0, value) }
            }
        )
    }

    public func position(editionId: Int) -> ReadingPosition? {
        all()[editionId]
    }

    public func save(_ position: ReadingPosition) throws {
        var positions = all()
        positions[position.editionId] = position
        try write(positions)
    }

    public func remove(editionId: Int) throws {
        var positions = all()
        guard positions.removeValue(forKey: editionId) != nil else { return }
        try write(positions)
    }

    private func write(_ positions: [Int: ReadingPosition]) throws {
        let keyed = Dictionary(
            uniqueKeysWithValues: positions.map { (String($0.key), $0.value) }
        )
        let data = try JSONEncoder().encode(keyed)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: fileURL, options: .atomic)
    }
}
