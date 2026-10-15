import Foundation

/// When to offer, unprompted, to carry the reader or listener to the spot they
/// reached in the book's other format. Pure decisions only; the server call and
/// the banner live in the app target.
public enum HandoffSuggestion {
    public enum Direction: String, Sendable {
        case toEbook = "to-ebook"
        case toAudiobook = "to-audiobook"
    }

    /// The other format must lead by more than this, so ordinary back-and-forth
    /// between two formats never costs a transcription.
    public static let minimumLeadMillis: Int64 = 60000
    /// Too close to the start for a sentence match to mean anything.
    public static let minimumListenSecs: Double = 30
    /// Same spine item, but further apart than this share of it.
    public static let minimumProgressionGap: Double = 0.02
    public static let minimumAudiobookGapSecs: Double = 20
    /// How long a banner stays up untouched.
    public static let bannerLifetimeSecs: Double = 12

    // MARK: Should we ask the server?

    /// Opening the reader: the audiobook was listened to more recently than the
    /// ebook was read. `agreedAtMillis` is the time of the last handoff, after
    /// which the two positions are known to match.
    public static func shouldCheckEbook(
        listenAtMillis: Int64?,
        listenPositionSecs: Double,
        readAtMillis: Int64?,
        agreedAtMillis: Int64? = nil
    ) -> Bool {
        guard let listenAtMillis, listenPositionSecs >= minimumListenSecs else { return false }
        let reference = max(readAtMillis ?? 0, agreedAtMillis ?? 0)
        return listenAtMillis - reference > minimumLeadMillis
    }

    /// Opening the player: the ebook was read more recently than the audiobook
    /// was listened to. A book never read has nothing to carry over.
    public static func shouldCheckAudiobook(
        readAtMillis: Int64?,
        listenAtMillis: Int64?,
        agreedAtMillis: Int64? = nil
    ) -> Bool {
        guard let readAtMillis else { return false }
        let reference = max(listenAtMillis ?? 0, agreedAtMillis ?? 0)
        return readAtMillis - reference > minimumLeadMillis
    }

    // MARK: Is the answer worth showing?

    /// The matched spot is in another spine item, or well away within the same one.
    /// Hrefs are compared the way `BookHandoff.matchReadingOrderHref` does, since the
    /// server's are OPF-relative and the reader's are container-relative.
    public static func isMeaningfullyDifferent(
        openedSpinePath: String?,
        openedProgression: Double?,
        matchedSpinePath: String,
        matchedProgression: Double
    ) -> Bool {
        guard let openedSpinePath,
              BookHandoff.matchReadingOrderHref(matchedSpinePath, in: [openedSpinePath]) != nil
        else { return true }
        return abs(matchedProgression - (openedProgression ?? 0)) > minimumProgressionGap
    }

    public static func isMeaningfullyDifferent(currentSecs: Double, matchedSecs: Double) -> Bool {
        abs(matchedSecs - currentSecs) > minimumAudiobookGapSecs
    }

    // MARK: Memo

    /// One background match per (book, direction, source position). Positions are
    /// rounded so jitter in the stored value does not read as movement.
    public static func memoKey(bookId: Int, listenPositionSecs: Double) -> String {
        "\(bookId)|\(Direction.toEbook.rawValue)|\(Int(listenPositionSecs.rounded()))"
    }

    public static func memoKey(bookId: Int, spinePath: String, progression: Double) -> String {
        let bucket = Int((min(max(progression, 0), 1) * 100).rounded())
        return "\(bookId)|\(Direction.toAudiobook.rawValue)|\(spinePath)|\(bucket)"
    }

    // MARK: Banner text

    /// The matched sentence from a Readium locator's `text.highlight`, trimmed and
    /// shortened to fit one line.
    public static func snippet(fromLocatorJSON json: String?, maxLength: Int = 60) -> String? {
        guard
            let data = json?.data(using: .utf8),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let text = root["text"] as? [String: Any],
            let highlight = text["highlight"] as? String
        else { return nil }
        let collapsed = highlight.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !collapsed.isEmpty else { return nil }
        guard collapsed.count > maxLength else { return collapsed }
        return String(collapsed.prefix(maxLength - 1)) + "…"
    }
}
