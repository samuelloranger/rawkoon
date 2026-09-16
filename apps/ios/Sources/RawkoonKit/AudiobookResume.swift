/// What a book's primary audio button offers: a fresh start, or a return to a
/// stored position. `.play` covers unstarted and finished alike — both begin at
/// zero, so the caller passes `resumeAt: 0` rather than letting the stored
/// position stand.
public enum AudiobookResumeLabel: Equatable, Sendable {
    case play
    case resume(positionSecs: Double)
}

/// Which audiobook a no-argument "resume" (Siri/Shortcuts) should play.
public enum AudiobookResume {
    /// The loaded edition if the player already has one; otherwise the most
    /// recently updated in-progress audiobook. Returns nil when nothing is
    /// playable, so the caller can report that rather than guess.
    public static func editionId(activeEditionId: Int?, entries: [CarPlayBrowseEntry]) -> Int? {
        if let activeEditionId {
            return activeEditionId
        }
        return entries
            .filter(\.isInProgress)
            .max { ($0.updatedAtMillis ?? 0) < ($1.updatedAtMillis ?? 0) }?
            .editionId
    }

    /// Resumable only strictly between the 1-second floor and the final second:
    /// below it nothing was heard, and within it the book is over, so resuming
    /// there would end playback on the first frame.
    public static func label(
        positionSecs: Double?,
        totalDurationSecs: Double?
    ) -> AudiobookResumeLabel {
        guard
            let positionSecs, let totalDurationSecs,
            positionSecs.isFinite, totalDurationSecs.isFinite,
            positionSecs > 1, totalDurationSecs > 1,
            positionSecs < totalDurationSecs - 1
        else {
            return .play
        }
        return .resume(positionSecs: positionSecs)
    }

    public static func label(for entry: CarPlayBrowseEntry) -> AudiobookResumeLabel {
        label(positionSecs: entry.positionSecs, totalDurationSecs: entry.totalDurationSecs)
    }
}
