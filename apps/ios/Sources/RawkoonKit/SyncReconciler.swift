import Foundation

public struct ProgressRecord: Equatable, Sendable {
    public let positionSecs: Double
    public let totalDurationSecs: Double
    public let finished: Bool
    public let updatedAtMillis: Int64

    public init(positionSecs: Double, totalDurationSecs: Double, finished: Bool, updatedAtMillis: Int64) {
        self.positionSecs = positionSecs
        self.totalDurationSecs = totalDurationSecs
        self.finished = finished
        self.updatedAtMillis = updatedAtMillis
    }
}

public enum SyncOutcome: Equatable, Sendable {
    case keepLocal
    case takeRemote
    case push
}

/// Decides which of two progress records wins, mirroring the server's rule.
///
/// Callers that adopt a `.takeRemote` or `.push` outcome must apply
/// `adjust(_:toTotal:)` before trusting or persisting the chosen record.
public enum SyncReconciler {
    public static func reconcile(local: ProgressRecord?, remote: ProgressRecord?) -> SyncOutcome {
        switch (local, remote) {
        case (nil, nil):
            return .keepLocal
        case (nil, .some):
            return .takeRemote
        case (.some, nil):
            return .push
        case let (.some(l), .some(r)):
            if r.updatedAtMillis > l.updatedAtMillis { return .takeRemote }
            if l.updatedAtMillis > r.updatedAtMillis { return .push }
            // A tie must be stable, or two devices flip the position forever.
            return .keepLocal
        }
    }

    /// Re-point a record at the current book length.
    ///
    /// A whole-book offset survives re-chapterising the same audio, but not an
    /// upgrade to a different rip. When the lengths disagree the position is
    /// approximate: clamp it, and never let the clamp set `finished`, because
    /// finished books are evicted automatically and that would delete a
    /// download out from under someone mid-listen.
    public static func adjust(_ remote: ProgressRecord, toTotal total: Double) -> ProgressRecord {
        guard remote.totalDurationSecs != total else { return remote }
        return ProgressRecord(
            positionSecs: min(max(remote.positionSecs, 0), total),
            totalDurationSecs: total,
            finished: false,
            updatedAtMillis: remote.updatedAtMillis
        )
    }
}
