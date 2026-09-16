import Foundation

/// What a book's primary ebook button offers. `.read` covers "never opened" and
/// "finished" alike — both start at the beginning, so the caller opens the
/// reader without the stored position rather than resuming on the last page.
public enum EbookResumeLabel: Equatable, Sendable {
    case read
    case resumeChapter(String)
    case resumePercent(Int)
}

public enum EbookResume {
    /// Below this the reader has not really started; it mirrors the 1-second
    /// floor the audiobook side uses.
    private static let startedFloor = 0.01

    /// Prefers the chapter the reader is actually in. A spine index cannot name
    /// it — the spine also holds the cover, title page and colophon — but the
    /// stored Readium locator carries the table-of-contents title, and its
    /// `totalProgression` is the real whole-book percent.
    public static func label(_ position: ReadingPosition?) -> EbookResumeLabel {
        guard let position, !position.finished else { return .read }

        let locator = position.locator.flatMap(parseLocator)

        if let title = locator?.title?.trimmingCharacters(in: .whitespacesAndNewlines),
           !title.isEmpty
        {
            return .resumeChapter(title)
        }

        // Without a locator — older stored positions, which predate it — the
        // spine is all there is. Documents differ wildly in length, so this is an
        // estimate, and only ever shown at whole-book granularity.
        let progression = locator?.totalProgression ?? spineEstimate(position)
        guard progression.isFinite, progression >= startedFloor else { return .read }
        return .resumePercent(min(Int(progression * 100), 99))
    }

    private static func spineEstimate(_ position: ReadingPosition) -> Double {
        guard position.spineCount > 0 else { return 0 }
        return (Double(position.spineIndex) + position.scrollFraction) / Double(position.spineCount)
    }

    /// Reads the two fields worth showing straight out of the stored JSON. The
    /// position keeps the locator as a string precisely so this package never
    /// imports Readium, which Linux CI cannot build.
    private static func parseLocator(_ raw: String) -> (title: String?, totalProgression: Double?)? {
        guard
            let data = raw.data(using: .utf8),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }
        let locations = root["locations"] as? [String: Any]
        return (root["title"] as? String, locations?["totalProgression"] as? Double)
    }
}
