import Foundation
import Observation

struct ServerQueryState<Value> {
    var value: Value?
    var errorDescription: String?
    var isLoading = false
    var isInvalidated = false
    var updatedAt: Date?
}

struct ServerMutationToken: Hashable, Sendable {
    let id = UUID()
}

nonisolated struct LibraryPage: Sendable {
    let items: [LibraryMedia]
    let hasMore: Bool
}

/// How much of a Library list the cache currently holds, so an invalidation can
/// refetch the pages the user scrolled through instead of collapsing to page 1.
nonisolated struct LibraryPagination: Sendable {
    var pagesLoaded = 0
    var hasMore = false
    var isLoadingMore = false
}

@MainActor
@Observable
final class ServerStateStore {
    var libraryLists: [LibraryListKey: ServerQueryState<[LibraryMedia]>] = [:]
    var libraryListSnapshots: [UUID: [LibraryListKey: ServerQueryState<[LibraryMedia]>]] = [:]
    /// Every live transaction that has patched a key, not just the last one —
    /// two overlapping mutations must each still find their own work.
    var libraryListOwners: [LibraryListKey: Set<UUID>] = [:]
    var libraryItems: [Int: ServerQueryState<LibraryMedia>] = [:]
    var libraryItemSnapshots: [UUID: [Int: ServerQueryState<LibraryMedia>]] = [:]
    var libraryItemOwners: [Int: Set<UUID>] = [:]
    var libraryPagination: [LibraryListKey: LibraryPagination] = [:]
    var libraryWindowTasks: [LibraryListKey: Task<Void, Error>] = [:]
    var invalidatedKeys: Set<ServerQueryKey> = []
    private(set) var generation = 0

    func libraryList(_ key: LibraryListKey) -> ServerQueryState<[LibraryMedia]> {
        libraryLists[key] ?? ServerQueryState()
    }

    func libraryItem(_ id: Int) -> ServerQueryState<LibraryMedia> {
        libraryItems[id] ?? ServerQueryState()
    }

    func seedLibraryItem(_ item: LibraryMedia) {
        libraryItems[item.id] = ServerQueryState(
            value: item,
            errorDescription: nil,
            isLoading: false,
            isInvalidated: false,
            updatedAt: Date()
        )
    }

    func needsLoad(_ key: LibraryListKey) -> Bool {
        let state = libraryList(key)
        return (state.value?.isEmpty ?? true) || state.isInvalidated
    }

    func pagination(_ key: LibraryListKey) -> LibraryPagination {
        libraryPagination[key] ?? LibraryPagination()
    }

    func isInvalidated(_ key: ServerQueryKey) -> Bool {
        if invalidatedKeys.contains(key) {
            return true
        }
        switch key {
        case let .libraryList(listKey):
            return libraryList(listKey).isInvalidated
        default:
            return false
        }
    }

    func seedLibraryList(
        _ items: [LibraryMedia],
        for key: LibraryListKey,
        pagesLoaded: Int = 1,
        hasMore: Bool = false
    ) {
        libraryLists[key] = ServerQueryState(
            value: items,
            errorDescription: nil,
            isLoading: false,
            isInvalidated: false,
            updatedAt: Date()
        )
        libraryPagination[key] = LibraryPagination(pagesLoaded: pagesLoaded, hasMore: hasMore)
    }

    /// Seeds a list nothing has loaded yet from its saved pages, marked stale so
    /// the next load refreshes it in place instead of starting from a skeleton.
    func hydrateLibraryList(_ key: LibraryListKey, items: [LibraryMedia], pagesLoaded: Int, hasMore: Bool) {
        guard libraryLists[key]?.value == nil else { return }
        libraryLists[key] = ServerQueryState(
            value: items,
            errorDescription: nil,
            isLoading: false,
            isInvalidated: true,
            updatedAt: nil
        )
        libraryPagination[key] = LibraryPagination(pagesLoaded: pagesLoaded, hasMore: hasMore)
    }

    func invalidate(_ key: ServerQueryKey) {
        invalidatedKeys.insert(key)
        switch key {
        case let .libraryList(listKey):
            invalidateLibraryList(listKey)
        case let .libraryItem(id):
            invalidatedKeys.insert(.libraryItem(id))
            invalidateLibraryItem(id)
            invalidateAllLibraryLists()
        case let .downloadHistory(id):
            invalidatedKeys.insert(.downloadHistory(id))
            invalidate(.libraryItem(id))
        case let .bookItem(id):
            invalidatedKeys.insert(.bookItem(id))
            invalidatedKeys.insert(.bookList)
            invalidatedKeys.insert(.progress)
        case .bookList:
            invalidatedKeys.insert(.bookList)
        case .progress:
            invalidatedKeys.insert(.progress)
        case .notifications:
            invalidatedKeys.insert(.notifications)
        case .unreadCount:
            invalidatedKeys.insert(.unreadCount)
        case .discoverDetail, .discoverDeck:
            break
        }
    }

    func invalidateAllLibraryLists() {
        for key in libraryLists.keys {
            invalidateLibraryList(key)
        }
    }

    private func invalidateLibraryItem(_ id: Int) {
        guard libraryItemOwners[id, default: []].isEmpty, libraryItems[id] != nil else { return }
        var state = libraryItem(id)
        state.isInvalidated = true
        libraryItems[id] = state
    }

    private func invalidateLibraryList(_ key: LibraryListKey) {
        guard libraryListOwners[key, default: []].isEmpty else { return }
        var state = libraryList(key)
        state.isInvalidated = true
        libraryLists[key] = state
    }

    func clear() {
        generation += 1
        for task in libraryWindowTasks.values {
            task.cancel()
        }
        libraryWindowTasks = [:]
        libraryPagination = [:]
        libraryLists = [:]
        libraryItems = [:]
        libraryListSnapshots = [:]
        libraryItemSnapshots = [:]
        libraryListOwners = [:]
        libraryItemOwners = [:]
        invalidatedKeys.removeAll()
    }
}
