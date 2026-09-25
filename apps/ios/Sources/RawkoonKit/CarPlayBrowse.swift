import Foundation

/// One audiobook as CarPlay needs to know it — a flattened, Linux-testable view
/// of a `LibrarySummary` plus its remote listening progress. The app layer maps
/// its UIKit-free types into this; the sectioning lives here so it is tested
/// without a simulator, matching the rest of RawkoonKit.
public struct CarPlayBrowseEntry: Sendable, Equatable {
    public let editionId: Int
    public let title: String
    public let author: String?
    public let positionSecs: Double?
    public let totalDurationSecs: Double?
    public let updatedAtMillis: Int64?
    /// Position in the library list as the server returned it; preserved so the
    /// Library section keeps the server's ordering.
    public let libraryOrder: Int

    public init(
        editionId: Int,
        title: String,
        author: String?,
        positionSecs: Double?,
        totalDurationSecs: Double?,
        updatedAtMillis: Int64?,
        libraryOrder: Int
    ) {
        self.editionId = editionId
        self.title = title
        self.author = author
        self.positionSecs = positionSecs
        self.totalDurationSecs = totalDurationSecs
        self.updatedAtMillis = updatedAtMillis
        self.libraryOrder = libraryOrder
    }

    /// Same rule the phone's Continue card uses: both numbers must be past the
    /// 1-second floor, so a zero/one-tick position never counts as started.
    public var isInProgress: Bool {
        guard let positionSecs, let totalDurationSecs else { return false }
        return positionSecs > 1 && totalDurationSecs > 1
    }
}

public enum CarPlayBrowse {
    /// Splits the library into the two CarPlay sections. `continueListening` is a
    /// shortcut (in-progress, most-recent first); `library` is everything, in
    /// server order — the full list still shows in-progress books too.
    public static func sections(
        entries: [CarPlayBrowseEntry]
    ) -> (continueListening: [CarPlayBrowseEntry], library: [CarPlayBrowseEntry]) {
        let continueListening = entries
            .filter(\.isInProgress)
            .sorted { ($0.updatedAtMillis ?? .min) > ($1.updatedAtMillis ?? .min) }
        let library = entries.sorted { $0.libraryOrder < $1.libraryOrder }
        return (continueListening, library)
    }

    /// The row subtitle. Both halves are optional, so the separator is only
    /// drawn between two parts that exist; the app layer localizes `resumeText`.
    /// The slice of a long list to show when a head unit caps item counts,
    /// centred on `current` so the playing chapter stays reachable.
    public static func window(count: Int, around current: Int?, limit: Int) -> Range<Int> {
        guard limit > 0, count > limit else { return 0 ..< max(count, 0) }
        let centre = min(max(current ?? 0, 0), count - 1)
        let start = min(max(centre - limit / 2, 0), count - limit)
        return start ..< start + limit
    }

    public static func detailText(resumeText: String?, author: String?) -> String? {
        let parts = [resumeText, author]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
