import Foundation

/// Which kind of edition a downloaded record describes. Audiobooks and ebooks
/// are the only offline-capable kinds; the raw values are the server's edition
/// `kind` strings so the record round-trips without translation.
public enum DownloadedKind: String, Codable, Sendable, Equatable {
    case audiobook
    case ebook
}

/// A single downloaded edition, flattened to exactly what the offline library
/// list needs — enough to render a row and open the book — without opening the
/// per-edition manifest. Persisted as one entry in `downloaded-index.json`; the
/// app layer writes it when a download completes and reads it to build the
/// library when the server is unreachable.
public struct DownloadedEdition: Codable, Sendable, Equatable {
    public let editionId: Int
    public let bookId: Int
    public let kind: DownloadedKind
    public let title: String
    public let author: String?
    public let totalDurationSecs: Double?
    public let fileCount: Int
    /// File name of the cached cover under the edition's directory, if one was
    /// saved. Nil when the cover could not be fetched — the row still renders.
    public let coverFileName: String?
    public let addedAtMillis: Int64

    public init(
        editionId: Int,
        bookId: Int,
        kind: DownloadedKind,
        title: String,
        author: String?,
        totalDurationSecs: Double?,
        fileCount: Int,
        coverFileName: String?,
        addedAtMillis: Int64
    ) {
        self.editionId = editionId
        self.bookId = bookId
        self.kind = kind
        self.title = title
        self.author = author
        self.totalDurationSecs = totalDurationSecs
        self.fileCount = fileCount
        self.coverFileName = coverFileName
        self.addedAtMillis = addedAtMillis
    }
}

/// Pure operations over the downloaded-editions index. All file IO lives in the
/// app layer (`DownloadedStore`); the decisions — dedup, ordering, membership —
/// live here so they are tested on Linux CI without a simulator, matching the
/// rest of RawkoonKit.
public enum DownloadedLibrary {
    /// Inserts `entry`, or replaces the existing record for the same edition in
    /// place (keeping its position) so a re-download refreshes metadata without
    /// reordering the list.
    public static func upsert(
        _ index: [DownloadedEdition], _ entry: DownloadedEdition
    ) -> [DownloadedEdition] {
        if let position = index.firstIndex(where: { $0.editionId == entry.editionId }) {
            var next = index
            next[position] = entry
            return next
        }
        return index + [entry]
    }

    /// Drops the record for `editionId`. A missing id is a no-op.
    public static func remove(
        _ index: [DownloadedEdition], editionId: Int
    ) -> [DownloadedEdition] {
        index.filter { $0.editionId != editionId }
    }

    /// The set of edition ids that are fully downloaded — the authoritative
    /// "is downloaded" answer for the online library's badges.
    public static func editionIds(_ index: [DownloadedEdition]) -> Set<Int> {
        Set(index.map(\.editionId))
    }

    /// Display order for the offline library: title, case-insensitively, with
    /// edition id as a stable tiebreak. Matches the phone library's title sort
    /// so the offline list is not jarringly reordered.
    public static func sortedForDisplay(
        _ index: [DownloadedEdition]
    ) -> [DownloadedEdition] {
        index.sorted { lhs, rhs in
            let byTitle = lhs.title.localizedCaseInsensitiveCompare(rhs.title)
            if byTitle != .orderedSame {
                return byTitle == .orderedAscending
            }
            return lhs.editionId < rhs.editionId
        }
    }
}
