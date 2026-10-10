import Foundation

/// Which live-download states earn motion: the progress sheen while bytes arrive, the check burst once done.
nonisolated enum DownloadMotion {
    static func isRunning(state: String) -> Bool {
        let lower = state.lowercased()
        return lower.contains("download") && !lower.contains("pause")
    }

    /// The same rule as the Activity queue's seeding phase.
    static func isComplete(state: String) -> Bool {
        let lower = state.lowercased()
        return lower.contains("seed") || lower.contains("complete")
    }
}
