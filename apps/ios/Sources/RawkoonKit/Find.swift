import Foundation

/// The two ways into the catalogue on the Find tab.
public enum FindMode: String, CaseIterable, Sendable {
    case browse, swipe
}

/// The catalogue pages the Library's chips open: the watchlist, collections and
/// shelves under the media stats, bestsellers on the Books page.
public enum FindShelf: String, CaseIterable, Hashable, Sendable {
    case watchlist, collections, shelves, bestsellers
}

/// The groups a Find search answers in, library first.
public enum FindResultGroup: String, CaseIterable, Sendable {
    case library, titles, books

    public static func visible(booksEnabled: Bool) -> [FindResultGroup] {
        allCases.filter { $0 != .books || booksEnabled }
    }
}

public enum FindSearch {
    /// Short queries keep showing Browse instead of a noisy result list.
    public static func isActive(_ query: String) -> Bool {
        query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }

    /// Browse's "Hide what I own": drops items already in the library when on.
    public static func visible<Item>(_ items: [Item], hideOwned: Bool, isOwned: (Item) -> Bool) -> [Item] {
        hideOwned ? items.filter { !isOwned($0) } : items
    }
}
