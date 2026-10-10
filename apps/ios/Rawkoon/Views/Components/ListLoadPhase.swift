import Foundation

/// What a cached list screen shows, in its branch order: a spinner or an error only while nothing is cached.
nonisolated enum ListLoadPhase: Equatable {
    case loading, offline, failed, empty, list

    /// `isEmpty`: nothing is cached; `showsNothing`: the current filter leaves no row to show.
    static func resolve(loading: Bool, offline: Bool, failed: Bool, isEmpty: Bool, showsNothing: Bool) -> Self {
        if loading, isEmpty {
            return .loading
        }
        if offline, failed, isEmpty {
            return .offline
        }
        if failed, isEmpty {
            return .failed
        }
        return showsNothing ? .empty : .list
    }
}
