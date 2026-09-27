import Foundation

public enum MediaPosterMenuAction: Equatable, Sendable, Hashable {
    case toggleMonitored
    case searchReleases
    case openDetails
    case removeFromLibrary

    /// Items that only do something with the server answering.
    public var requiresConnection: Bool {
        self != .openDetails
    }
}

/// Which long-press items a library poster should offer.
///
/// Admin-only actions match what 403s on the server. Search and Open details
/// are reachable today from MediaDetailView for any signed-in user. Offline,
/// server-only items are left out: the menus render plain actions, with no
/// disabled state to show.
public func mediaPosterMenuItems(inLibrary: Bool, isAdmin: Bool, isOffline: Bool = false) -> [MediaPosterMenuAction] {
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
    return isOffline ? items.filter { !$0.requiresConnection } : items
}

public enum BookCardMenuAction: Equatable, Sendable, Hashable {
    case read
    case play
    case markRead
    case markUnread
    case addAudiobook
    case addEbook
    case rescan

    /// Items that only do something with the server answering. Read and Play
    /// can still open a downloaded edition.
    public var requiresConnection: Bool {
        switch self {
        case .read, .play: false
        case .markRead, .markUnread, .addAudiobook, .addEbook, .rescan: true
        }
    }
}

/// Which long-press items a book card should offer.
///
/// Read/Play follow BookView: an edition that exists is playable/readable.
/// Mark as read is the whole-book flag (not the ebook "Read" action).
/// Add is admin-only and only for a missing kind. Rescan is admin-only and
/// only when at least one edition exists to rescan. Offline, server-only items
/// are left out.
public func bookCardMenuItems(
    hasAudiobook: Bool,
    hasEbook: Bool,
    isAdmin: Bool,
    isRead: Bool,
    isOffline: Bool = false
) -> [BookCardMenuAction] {
    var items: [BookCardMenuAction] = []
    if hasEbook {
        items.append(.read)
    }
    if hasAudiobook {
        items.append(.play)
    }
    items.append(isRead ? .markUnread : .markRead)
    if isAdmin {
        if !hasAudiobook {
            items.append(.addAudiobook)
        }
        if !hasEbook {
            items.append(.addEbook)
        }
        if hasAudiobook || hasEbook {
            items.append(.rescan)
        }
    }
    return isOffline ? items.filter { !$0.requiresConnection } : items
}
