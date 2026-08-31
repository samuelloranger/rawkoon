import Foundation

public enum MediaPosterMenuAction: Equatable, Sendable, Hashable {
    case toggleMonitored
    case searchReleases
    case openDetails
    case removeFromLibrary
}

/// Which long-press items a library poster should offer.
///
/// Admin-only actions match what 403s on the server. Search and Open details
/// are reachable today from MediaDetailView for any signed-in user.
public func mediaPosterMenuItems(inLibrary: Bool, isAdmin: Bool) -> [MediaPosterMenuAction] {
    var items: [MediaPosterMenuAction] = []
    if inLibrary, isAdmin {
        items.append(.toggleMonitored)
    }
    if inLibrary {
        items.append(.searchReleases)
    }
    items.append(.openDetails)
    if inLibrary, isAdmin {
        items.append(.removeFromLibrary)
    }
    return items
}

public enum BookCardMenuAction: Equatable, Sendable, Hashable {
    case read
    case play
    case addAudiobook
    case addEPUB
    case rescan
}

/// Which long-press items a book card should offer.
///
/// Read/Play follow BookView: an edition that exists is playable/readable.
/// Add is admin-only and only for a missing kind. Rescan is admin-only and
/// only when at least one edition exists to rescan.
public func bookCardMenuItems(hasAudiobook: Bool, hasEbook: Bool, isAdmin: Bool) -> [BookCardMenuAction] {
    var items: [BookCardMenuAction] = []
    if hasEbook {
        items.append(.read)
    }
    if hasAudiobook {
        items.append(.play)
    }
    if isAdmin {
        if !hasAudiobook {
            items.append(.addAudiobook)
        }
        if !hasEbook {
            items.append(.addEPUB)
        }
        if hasAudiobook || hasEbook {
            items.append(.rescan)
        }
    }
    return items
}
