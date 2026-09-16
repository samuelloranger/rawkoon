import Foundation

struct LibraryListKey: Hashable, Sendable {
    let type: String?
    let status: String?
    let query: String?
    let page: Int
    let limit: Int
    let sortBy: String?
    let sortDirection: String?

    init(
        type: String? = nil,
        status: String? = nil,
        query: String? = nil,
        page: Int = 1,
        limit: Int = 40,
        sortBy: String? = "added_at",
        sortDirection: String? = "desc"
    ) {
        self.type = type
        self.status = status
        self.query = query
        self.page = page
        self.limit = limit
        self.sortBy = sortBy
        self.sortDirection = sortDirection
    }

    static let `default` = LibraryListKey()
}

enum ServerQueryKey: Hashable, Sendable {
    case libraryList(LibraryListKey)
    case libraryItem(Int)
    case downloadHistory(Int)
    case discoverDetail(tmdbID: Int, type: String)
    case discoverDeck
    case bookList
    case bookItem(Int)
    case progress
    case notifications
    case unreadCount
}

enum ServerMutation: Sendable { case removeLibraryItem(Int), addLibraryItem, updateLibraryItem(Int) }
