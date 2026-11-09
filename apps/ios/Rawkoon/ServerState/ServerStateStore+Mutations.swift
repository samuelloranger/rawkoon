import Foundation

extension ServerStateStore {
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
        libraryListOwners[key, default: []].insert(token.id)
    }

    func commit(_ token: ServerMutationToken) {
        libraryListSnapshots[token.id] = nil
        libraryItemSnapshots[token.id] = nil
        releaseOwnership(of: token)
    }

    /// Restores what this transaction changed. Where another transaction has
    /// since patched the same entry, its snapshot would erase that work, so the
    /// entry is marked stale for a refetch instead of being restored.
    func rollback(_ token: ServerMutationToken) {
        if let snapshots = libraryListSnapshots.removeValue(forKey: token.id) {
            for (key, snapshot) in snapshots where libraryListOwners[key, default: []].contains(token.id) {
                if libraryListOwners[key, default: []].subtracting([token.id]).isEmpty {
                    libraryLists[key] = snapshot
                } else {
                    var state = libraryList(key)
                    state.isInvalidated = true
                    libraryLists[key] = state
                }
            }
        }
        if let snapshots = libraryItemSnapshots.removeValue(forKey: token.id) {
            for (id, snapshot) in snapshots where libraryItemOwners[id, default: []].contains(token.id) {
                if libraryItemOwners[id, default: []].subtracting([token.id]).isEmpty {
                    libraryItems[id] = snapshot
                } else {
                    var state = libraryItem(id)
                    state.isInvalidated = true
                    libraryItems[id] = state
                }
            }
        }
        releaseOwnership(of: token)
    }

    private func releaseOwnership(of token: ServerMutationToken) {
        for key in Array(libraryListOwners.keys) {
            libraryListOwners[key]?.remove(token.id)
            if libraryListOwners[key]?.isEmpty == true {
                libraryListOwners[key] = nil
            }
        }
        for id in Array(libraryItemOwners.keys) {
            libraryItemOwners[id]?.remove(token.id)
            if libraryItemOwners[id]?.isEmpty == true {
                libraryItemOwners[id] = nil
            }
        }
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
            libraryItemOwners[id, default: []].insert(token.id)
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
            libraryListOwners[key, default: []].insert(token.id)
        }
        if var state = libraryItems[id], var item = state.value {
            patch(&item)
            state.value = item
            state.isInvalidated = false
            libraryItems[id] = state
            libraryItemOwners[id, default: []].insert(token.id)
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
            libraryListOwners[key, default: []].insert(token.id)
        }
    }

    private func replaceProvisional(tmdbId: Int, with item: LibraryMedia, token: ServerMutationToken) {
        for (key, owners) in libraryListOwners where owners.contains(token.id) {
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
}
