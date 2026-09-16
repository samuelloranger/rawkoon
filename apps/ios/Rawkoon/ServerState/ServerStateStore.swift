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
    fileprivate let id = UUID()
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
    private(set) var libraryLists: [LibraryListKey: ServerQueryState<[LibraryMedia]>] = [:]
    private var libraryListTasks: [LibraryListKey: Task<[LibraryMedia], Error>] = [:]
    private var libraryListSnapshots: [UUID: [LibraryListKey: ServerQueryState<[LibraryMedia]>]] = [:]
    private var libraryListOwners: [LibraryListKey: UUID] = [:]
    private(set) var libraryItems: [Int: ServerQueryState<LibraryMedia>] = [:]
    private var libraryItemSnapshots: [UUID: [Int: ServerQueryState<LibraryMedia>]] = [:]
    private var libraryItemOwners: [Int: UUID] = [:]
    private(set) var libraryPagination: [LibraryListKey: LibraryPagination] = [:]
    private var libraryWindowTasks: [LibraryListKey: Task<Void, Error>] = [:]
    private(set) var invalidatedKeys: Set<ServerQueryKey> = []
    private var generation = 0

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

    // MARK: Windowed Library loading

    /// Loads pages `1...pages` and replaces the cached window in place. Equal
    /// concurrent calls share one load.
    func loadLibraryWindow(
        _ key: LibraryListKey,
        pages: Int,
        loader: @escaping @Sendable (Int) async throws -> LibraryPage
    ) async throws {
        if let task = libraryWindowTasks[key] {
            return try await task.value
        }

        let loadGeneration = generation
        let requested = max(pages, 1)
        var state = libraryList(key)
        state.isLoading = true
        state.errorDescription = nil
        libraryLists[key] = state

        let task = Task { [weak self] in
            var merged: [LibraryMedia] = []
            var hasMore = false
            for page in 1 ... requested {
                try Task.checkCancellation()
                let result = try await loader(page)
                for item in result.items where !merged.contains(where: { $0.id == item.id }) {
                    merged.append(item)
                }
                hasMore = result.hasMore
            }
            try Task.checkCancellation()
            self?.applyWindow(key, items: merged, pagesLoaded: requested, hasMore: hasMore, loadGeneration: loadGeneration)
        }
        libraryWindowTasks[key] = task
        do {
            try await task.value
            libraryWindowTasks[key] = nil
        } catch {
            libraryWindowTasks[key] = nil
            guard loadGeneration == generation else { throw error }
            if !(error is CancellationError) {
                var failed = libraryList(key)
                failed.isLoading = false
                failed.errorDescription = error.localizedDescription
                libraryLists[key] = failed
            }
            throw error
        }
    }

    /// Refetches exactly the pages already loaded, so live updates never drop
    /// pages the user scrolled past.
    func refreshLibraryWindow(
        _ key: LibraryListKey,
        loader: @escaping @Sendable (Int) async throws -> LibraryPage
    ) async throws {
        try await loadLibraryWindow(key, pages: max(pagination(key).pagesLoaded, 1), loader: loader)
    }

    func loadNextLibraryPage(
        _ key: LibraryListKey,
        loader: @escaping @Sendable (Int) async throws -> LibraryPage
    ) async throws {
        if let task = libraryWindowTasks[key] {
            return try await task.value
        }
        var current = pagination(key)
        guard current.pagesLoaded == 0 || current.hasMore else { return }
        let nextPage = current.pagesLoaded + 1
        let loadGeneration = generation
        current.isLoadingMore = true
        libraryPagination[key] = current

        let task = Task { [weak self] in
            let result = try await loader(nextPage)
            try Task.checkCancellation()
            self?.appendPage(key, result: result, page: nextPage, loadGeneration: loadGeneration)
        }
        libraryWindowTasks[key] = task
        do {
            try await task.value
            libraryWindowTasks[key] = nil
        } catch {
            libraryWindowTasks[key] = nil
            var failed = pagination(key)
            failed.isLoadingMore = false
            libraryPagination[key] = failed
            guard loadGeneration == generation, !(error is CancellationError) else { throw error }
            var state = libraryList(key)
            state.errorDescription = error.localizedDescription
            libraryLists[key] = state
            throw error
        }
    }

    private func applyWindow(
        _ key: LibraryListKey,
        items: [LibraryMedia],
        pagesLoaded: Int,
        hasMore: Bool,
        loadGeneration: Int
    ) {
        guard loadGeneration == generation else { return }
        var state = libraryList(key)
        state.value = preservingPendingAdds(in: state.value, replacedBy: items)
        state.isLoading = false
        state.isInvalidated = false
        state.errorDescription = nil
        state.updatedAt = Date()
        libraryLists[key] = state
        var page = pagination(key)
        page.pagesLoaded = pagesLoaded
        page.hasMore = hasMore
        page.isLoadingMore = false
        libraryPagination[key] = page
    }

    private func appendPage(_ key: LibraryListKey, result: LibraryPage, page: Int, loadGeneration: Int) {
        guard loadGeneration == generation else { return }
        var state = libraryList(key)
        var merged = state.value ?? []
        for item in result.items where !merged.contains(where: { $0.id == item.id }) {
            merged.append(item)
        }
        state.value = merged
        state.errorDescription = nil
        state.updatedAt = Date()
        libraryLists[key] = state
        libraryPagination[key] = LibraryPagination(pagesLoaded: page, hasMore: result.hasMore, isLoadingMore: false)
    }

    /// A refresh that lands mid-add must not erase the row that add is showing.
    private func preservingPendingAdds(in previous: [LibraryMedia]?, replacedBy items: [LibraryMedia]) -> [LibraryMedia] {
        let pending = (previous ?? []).filter(\.isProvisional)
        guard !pending.isEmpty else { return items }
        var merged = items
        for row in pending.reversed() where !merged.contains(where: { $0.tmdbId == row.tmdbId }) {
            merged.insert(row, at: 0)
        }
        return merged
    }

    func loadLibraryList(
        _ key: LibraryListKey,
        loader: @escaping @Sendable () async throws -> [LibraryMedia]
    ) async throws -> [LibraryMedia] {
        if let task = libraryListTasks[key] {
            return try await task.value
        }

        let loadGeneration = generation
        var state = libraryList(key)
        state.isLoading = true
        state.errorDescription = nil
        libraryLists[key] = state

        let task = Task { try await loader() }
        libraryListTasks[key] = task
        do {
            let value = try await task.value
            libraryListTasks[key] = nil
            guard loadGeneration == generation else { return value }
            var refreshed = libraryList(key)
            refreshed.value = value
            refreshed.isLoading = false
            refreshed.isInvalidated = false
            refreshed.updatedAt = Date()
            libraryLists[key] = refreshed
            return value
        } catch {
            libraryListTasks[key] = nil
            guard loadGeneration == generation else { throw error }
            var failed = libraryList(key)
            failed.isLoading = false
            failed.errorDescription = error.localizedDescription
            libraryLists[key] = failed
            throw error
        }
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
        guard libraryItemOwners[id] == nil, libraryItems[id] != nil else { return }
        var state = libraryItem(id)
        state.isInvalidated = true
        libraryItems[id] = state
    }

    private func invalidateLibraryList(_ key: LibraryListKey) {
        guard libraryListOwners[key] == nil else { return }
        var state = libraryList(key)
        state.isInvalidated = true
        libraryLists[key] = state
    }

    func beginMutation(_: ServerMutation) -> ServerMutationToken {
        let token = ServerMutationToken()
        libraryListSnapshots[token.id] = libraryLists
        libraryItemSnapshots[token.id] = libraryItems
        return token
    }

    func removeLibraryItemOptimistically(id: Int, from key: LibraryListKey, token: ServerMutationToken) {
        guard libraryListSnapshots[token.id] != nil else { return }
        var state = libraryList(key)
        state.value?.removeAll { $0.id == id }
        state.isInvalidated = false
        libraryLists[key] = state
        libraryListOwners[key] = token.id
    }

    func commit(_ token: ServerMutationToken) {
        libraryListSnapshots[token.id] = nil
        libraryItemSnapshots[token.id] = nil
        libraryListOwners = libraryListOwners.filter { $0.value != token.id }
        libraryItemOwners = libraryItemOwners.filter { $0.value != token.id }
    }

    func rollback(_ token: ServerMutationToken) {
        if let snapshots = libraryListSnapshots.removeValue(forKey: token.id) {
            for (key, snapshot) in snapshots where libraryListOwners[key] == token.id {
                libraryLists[key] = snapshot
            }
        }
        if let snapshots = libraryItemSnapshots.removeValue(forKey: token.id) {
            for (id, snapshot) in snapshots where libraryItemOwners[id] == token.id {
                libraryItems[id] = snapshot
            }
        }
        libraryListOwners = libraryListOwners.filter { $0.value != token.id }
        libraryItemOwners = libraryItemOwners.filter { $0.value != token.id }
    }

    // MARK: Mutations

    /// Shows `provisional` in every cached list that could contain it, then
    /// swaps in the server's created item — or removes it again on failure.
    @discardableResult
    func addToLibrary(
        provisional: LibraryMedia,
        request: @escaping @Sendable () async throws -> LibraryMedia
    ) async throws -> LibraryMedia {
        let token = beginMutation(.addLibraryItem)
        insertProvisional(provisional, token: token)
        do {
            let item = try await request()
            replaceProvisional(tmdbId: provisional.tmdbId, with: item, token: token)
            commit(token)
            invalidateAllLibraryLists()
            invalidate(.discoverDeck)
            invalidate(.discoverDetail(tmdbID: provisional.tmdbId, type: provisional.type))
            return item
        } catch {
            rollback(token)
            throw error
        }
    }

    /// Removes the row from every cached list straight away and puts it back if
    /// the request fails, so loaded pages and scroll position never reset.
    func removeLibraryItem(id: Int, request: @escaping @Sendable () async throws -> Void) async throws {
        let token = beginMutation(.removeLibraryItem(id))
        for key in Array(libraryLists.keys) where libraryList(key).value?.contains(where: { $0.id == id }) == true {
            removeLibraryItemOptimistically(id: id, from: key, token: token)
        }
        if libraryItems[id] != nil {
            libraryItemOwners[id] = token.id
            libraryItems[id] = nil
        }
        do {
            try await request()
            commit(token)
            invalidatedKeys.insert(.libraryItem(id))
            invalidateAllLibraryLists()
        } catch {
            rollback(token)
            throw error
        }
    }

    @discardableResult
    func updateMonitored(
        id: Int,
        monitored: Bool,
        request: @escaping @Sendable () async throws -> LibraryMedia
    ) async throws -> LibraryMedia {
        try await mutateLibraryItem(id: id, request: request) { item in
            item.monitored = monitored
        }
    }

    /// Only the id is patched — the profile's name comes back with the server's
    /// item, which lands a moment later.
    @discardableResult
    func updateQualityProfile(
        id: Int,
        qualityProfileId: Int?,
        request: @escaping @Sendable () async throws -> LibraryMedia
    ) async throws -> LibraryMedia {
        try await mutateLibraryItem(id: id, request: request) { item in
            item.qualityProfileId = qualityProfileId
            if item.qualityProfile?.id != qualityProfileId {
                item.qualityProfile = nil
            }
        }
    }

    /// Download and file actions keep their own in-place UI, so nothing is
    /// patched — the item, its lists and its history just go stale.
    func invalidateDownloadHistory(itemID: Int) {
        invalidate(.downloadHistory(itemID))
    }

    func invalidateLibraryRollup(itemID: Int) {
        invalidate(.libraryItem(itemID))
    }

    private func mutateLibraryItem(
        id: Int,
        request: @escaping @Sendable () async throws -> LibraryMedia,
        patch: (inout LibraryMedia) -> Void
    ) async throws -> LibraryMedia {
        let token = beginMutation(.updateLibraryItem(id))
        applyOptimisticPatch(id: id, token: token, patch: patch)
        do {
            let item = try await request()
            commit(token)
            patchLibraryItem(item)
            invalidate(.libraryItem(id))
            return item
        } catch {
            rollback(token)
            throw error
        }
    }

    private func applyOptimisticPatch(id: Int, token: ServerMutationToken, patch: (inout LibraryMedia) -> Void) {
        for key in Array(libraryLists.keys) {
            var state = libraryList(key)
            guard var items = state.value, let index = items.firstIndex(where: { $0.id == id }) else { continue }
            patch(&items[index])
            state.value = items
            state.isInvalidated = false
            libraryLists[key] = state
            libraryListOwners[key] = token.id
        }
        if var state = libraryItems[id], var item = state.value {
            patch(&item)
            state.value = item
            state.isInvalidated = false
            libraryItems[id] = state
            libraryItemOwners[id] = token.id
        }
    }

    /// Replaces a server-confirmed item everywhere it is cached, without
    /// refetching — loaded pages and scroll position stay put.
    func patchLibraryItem(_ item: LibraryMedia) {
        for key in Array(libraryLists.keys) {
            var state = libraryList(key)
            guard var items = state.value, let index = items.firstIndex(where: { $0.id == item.id }) else { continue }
            items[index] = item
            state.value = items
            libraryLists[key] = state
        }
        if libraryItems[item.id] != nil {
            seedLibraryItem(item)
        }
    }

    func deleteLibraryItem(id: Int) {
        for key in Array(libraryLists.keys) {
            var state = libraryList(key)
            guard var items = state.value, items.contains(where: { $0.id == id }) else { continue }
            items.removeAll { $0.id == id }
            state.value = items
            libraryLists[key] = state
        }
    }

    /// A filtered or searched list only shows the pending row when the filter
    /// can actually contain it.
    private func acceptsProvisional(_ key: LibraryListKey, _ item: LibraryMedia) -> Bool {
        if let query = key.query, !query.isEmpty {
            return false
        }
        if let type = key.type, type != item.type {
            return false
        }
        if let status = key.status, status != item.status {
            return false
        }
        return true
    }

    private func insertProvisional(_ item: LibraryMedia, token: ServerMutationToken) {
        for key in Array(libraryLists.keys) where acceptsProvisional(key, item) {
            var state = libraryList(key)
            var items = state.value ?? []
            guard !items.contains(where: { $0.tmdbId == item.tmdbId }) else { continue }
            // Newest-first is the default sort; a post-commit refresh fixes any other.
            items.insert(item, at: 0)
            state.value = items
            state.isInvalidated = false
            libraryLists[key] = state
            libraryListOwners[key] = token.id
        }
    }

    private func replaceProvisional(tmdbId: Int, with item: LibraryMedia, token: ServerMutationToken) {
        for (key, ownerID) in libraryListOwners where ownerID == token.id {
            var state = libraryList(key)
            guard var items = state.value else { continue }
            if let index = items.firstIndex(where: { $0.isProvisional && $0.tmdbId == tmdbId }) {
                items.remove(at: index)
                if !items.contains(where: { $0.id == item.id }) {
                    items.insert(item, at: index)
                }
            } else if !items.contains(where: { $0.id == item.id }) {
                items.insert(item, at: 0)
            }
            state.value = items
            libraryLists[key] = state
        }
    }

    func clear() {
        generation += 1
        for task in libraryListTasks.values {
            task.cancel()
        }
        for task in libraryWindowTasks.values {
            task.cancel()
        }
        libraryListTasks = [:]
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
