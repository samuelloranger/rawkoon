import Foundation

public enum MediaPosterMenuAction: Equatable, Sendable, Hashable {
    case toggleMonitored
    case autoSearch
    case searchReleases
    case openDetails
    case removeFromLibrary

    /// Items that only do something with the server answering.
    public var requiresConnection: Bool {
        self != .openDetails
    }
}

/// Whether a library item offers the one-tap movie auto search: movies only,
/// and only while nothing is downloaded or downloading (the server refuses a
/// search on a downloading item).
public func movieCanAutoSearch(type: String, status: String) -> Bool {
    type == "movie" && (status == "wanted" || status == "missing")
}

/// Which long-press items a library poster should offer.
///
/// Admin-only actions match what 403s on the server. Search and Open details
/// are reachable today from MediaDetailView for any signed-in user. Offline,
/// the menu greys out the items whose `requiresConnection` is true.
public func mediaPosterMenuItems(
    inLibrary: Bool,
    isAdmin: Bool,
    canAutoSearch: Bool = false
) -> [MediaPosterMenuAction] {
    var items: [MediaPosterMenuAction] = []
    if inLibrary, isAdmin {
        items.append(.toggleMonitored)
    }
    if inLibrary, isAdmin, canAutoSearch {
        items.append(.autoSearch)
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
    case markRead
    case markUnread
    case resetProgress
    case download
    case removeDownload
    case addAudiobook
    case addEbook
    case rescan

    /// Items that only do something with the server answering. Read and Play
    /// can still open a downloaded edition.
    public var requiresConnection: Bool {
        switch self {
        case .read, .play, .removeDownload: false
        case .markRead, .markUnread, .resetProgress, .download, .addAudiobook, .addEbook, .rescan: true
        }
    }
}

/// Which long-press items a book card should offer.
///
/// Read/Play follow BookView: an edition that exists is playable/readable.
/// Mark as read is the whole-book flag (not the ebook "Read" action).
/// Reset progress needs progress to reset; Download is the audiobook (ebook
/// downloads pick a file on the detail page). Add is admin-only and only for a missing kind. Rescan is admin-only and
/// only when at least one edition exists to rescan. Offline, the menu greys out
/// the items whose `requiresConnection` is true.
public func bookCardMenuItems(
    hasAudiobook: Bool,
    hasEbook: Bool,
    isAdmin: Bool,
    isRead: Bool,
    hasProgress: Bool = false,
    audiobookDownloaded: Bool = false
) -> [BookCardMenuAction] {
    var items: [BookCardMenuAction] = []
    if hasEbook {
        items.append(.read)
    }
    if hasAudiobook {
        items.append(.play)
    }
    items.append(isRead ? .markUnread : .markRead)
    if hasProgress {
        items.append(.resetProgress)
    }
    if hasAudiobook {
        items.append(audiobookDownloaded ? .removeDownload : .download)
    }
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
    return items
}
