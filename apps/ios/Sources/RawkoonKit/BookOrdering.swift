import Foundation

/// What the book list order depends on, flattened so every surface (phone
/// library, offline library, CarPlay) ranks books with the same inputs.
public struct BookOrderKey: Sendable, Equatable {
    public let id: Int
    public let title: String
    public let isInProgress: Bool
    public let isDownloaded: Bool

    public init(id: Int, title: String, isInProgress: Bool, isDownloaded: Bool) {
        self.id = id
        self.title = title
        self.isInProgress = isInProgress
        self.isDownloaded = isDownloaded
    }
}

/// The single book list order: in-progress books, then downloaded ones, then
/// the rest; alphabetical within each tier. Pure, so it is tested on Linux.
public enum BookOrdering {
    /// Both numbers past the 1-second floor, so a zero/one-tick position never
    /// counts as started. A listening-finished edition is not in progress.
    public static func isAudiobookInProgress(
        positionSecs: Double, totalDurationSecs: Double, finished: Bool
    ) -> Bool {
        !finished && positionSecs > 1 && totalDurationSecs > 1
    }

    public static func isEbookInProgress(
        spineIndex: Int, scrollFraction: Double, finished: Bool
    ) -> Bool {
        !finished && (spineIndex > 0 || scrollFraction > 0.01)
    }

    /// Read status is ignored: a read book being listened to again shows a
    /// progress bar, so it ranks as in progress.
    public static func isInProgress(audiobookInProgress: Bool, ebookInProgress: Bool) -> Bool {
        audiobookInProgress || ebookInProgress
    }

    public static func areInOrder(_ lhs: BookOrderKey, _ rhs: BookOrderKey) -> Bool {
        let (lhsTier, rhsTier) = (tier(lhs), tier(rhs))
        if lhsTier != rhsTier {
            return lhsTier < rhsTier
        }
        let byTitle = lhs.title.compare(
            rhs.title, options: [.caseInsensitive, .diacriticInsensitive],
            range: nil, locale: .current
        )
        if byTitle != .orderedSame {
            return byTitle == .orderedAscending
        }
        return lhs.id < rhs.id
    }

    public static func sorted<T>(_ items: [T], key: (T) -> BookOrderKey) -> [T] {
        items
            .map { (item: $0, key: key($0)) }
            .sorted { areInOrder($0.key, $1.key) }
            .map(\.item)
    }

    private static func tier(_ key: BookOrderKey) -> Int {
        key.isInProgress ? 0 : (key.isDownloaded ? 1 : 2)
    }
}
