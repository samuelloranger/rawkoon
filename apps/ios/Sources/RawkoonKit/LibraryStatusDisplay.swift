import Foundation

/// The label a library title is shown under.
///
/// The server reports acquisition status (`downloaded`, `wanted`, …) and a show's airing
/// state (`returning`, `in_production`, `planned`, `ended`) as separate fields. A downloaded
/// show that is still airing reads as its airing state; everything else keeps its status.
public enum LibraryStatusDisplay {
    private static let airingLabels: Set<String> = ["returning", "in_production", "planned"]

    public static func status(_ status: String, airingState: String?) -> String {
        if status == "downloaded", let airingState, airingLabels.contains(airingState) {
            return airingState
        }
        return status
    }
}
