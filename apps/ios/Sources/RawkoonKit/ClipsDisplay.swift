import Foundation

/// Wording and gating for the preview-clips admin screen.
public enum ClipsDisplay {
    /// "Title" for a movie, "Title · S2" for a season clip.
    public static func itemLabel(title: String, seasonNumber: Int?) -> String {
        guard let seasonNumber, seasonNumber > 0 else { return title }
        return "\(title) · S\(seasonNumber)"
    }

    /// The server refuses to delete while clips are on; the screen disables the button to match.
    public static func canDeleteAll(enabled: Bool, doneCount: Int, totalBytes: Int64) -> Bool {
        !enabled && (doneCount > 0 || totalBytes > 0)
    }
}
