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
}
