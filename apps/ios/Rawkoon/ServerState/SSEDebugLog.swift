import Foundation

/// Connection state of one SSE stream, for the admin-only SSE debug screen.
enum SSEStreamStatus: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case reconnecting
}

/// One line in the SSE debug screen's live event log.
struct SSEDebugLogEntry: Identifiable, Equatable, Sendable {
    let id = UUID()
    let timestamp: Date
    let stream: String
    let summary: String
}

/// Prepends `entry` and trims to `limit`, newest first. Pure so the capping
/// behavior is testable without spinning up `AppModel`.
func appendSSELog(
    _ log: [SSEDebugLogEntry],
    entry: SSEDebugLogEntry,
    limit: Int
) -> [SSEDebugLogEntry] {
    var next = log
    next.insert(entry, at: 0)
    if next.count > limit {
        next.removeLast(next.count - limit)
    }
    return next
}
