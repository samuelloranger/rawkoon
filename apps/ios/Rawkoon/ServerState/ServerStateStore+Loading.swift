import Foundation

extension ServerStateStore {
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
}
