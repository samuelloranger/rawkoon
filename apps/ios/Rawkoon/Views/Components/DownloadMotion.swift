import Foundation

/// Which live-download states earn motion: the progress sheen while bytes arrive, the check burst once done.
nonisolated enum DownloadMotion {
    /// The server folds queued and checking torrents into "downloading", so speed is what proves bytes move.
    static func isRunning(state: String, speed: Double) -> Bool {
        let lower = state.lowercased()
        return lower.contains("download") && !lower.contains("pause") && speed.isFinite && speed > 0
    }

    /// The same rule as the Activity queue's seeding phase.
    static func isComplete(state: String) -> Bool {
        let lower = state.lowercased()
        return lower.contains("seed") || lower.contains("complete")
    }
}
