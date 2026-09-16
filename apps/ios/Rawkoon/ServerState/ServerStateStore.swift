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

@MainActor
@Observable
final class ServerStateStore {
    private(set) var libraryLists: [LibraryListKey: ServerQueryState<[LibraryMedia]>] = [:]
    private var libraryListTasks: [LibraryListKey: Task<[LibraryMedia], Error>] = [:]
    private var libraryListSnapshots: [UUID: [LibraryListKey: ServerQueryState<[LibraryMedia]>]] = [:]
    private var libraryListOwners: [LibraryListKey: UUID] = [:]
    private var generation = 0

    func libraryList(_ key: LibraryListKey) -> ServerQueryState<[LibraryMedia]> {
        libraryLists[key] ?? ServerQueryState()
    }

    func seedLibraryList(_ items: [LibraryMedia], for key: LibraryListKey) {
        libraryLists[key] = ServerQueryState(
            value: items,
            errorDescription: nil,
            isLoading: false,
            isInvalidated: false,
            updatedAt: Date()
        )
    }

    func loadLibraryList(
        _ key: LibraryListKey,
        loader: @escaping @Sendable () async throws -> [LibraryMedia]
    ) async throws -> [LibraryMedia] {
        if let task = libraryListTasks[key] { return try await task.value }

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
        switch key {
        case .libraryList(let listKey): invalidateLibraryList(listKey)
        case .libraryItem: invalidateAllLibraryLists()
        }
    }

    func invalidateAllLibraryLists() {
        for key in libraryLists.keys { invalidateLibraryList(key) }
    }

    private func invalidateLibraryList(_ key: LibraryListKey) {
        guard libraryListOwners[key] == nil else { return }
        var state = libraryList(key)
        state.isInvalidated = true
        libraryLists[key] = state
    }

    func beginMutation(_ mutation: ServerMutation) -> ServerMutationToken {
        let token = ServerMutationToken()
        libraryListSnapshots[token.id] = libraryLists
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
        libraryListOwners = libraryListOwners.filter { $0.value != token.id }
    }

    func rollback(_ token: ServerMutationToken) {
        guard let snapshots = libraryListSnapshots.removeValue(forKey: token.id) else { return }
        for (key, snapshot) in snapshots where libraryListOwners[key] == token.id {
            libraryLists[key] = snapshot
        }
        libraryListOwners = libraryListOwners.filter { $0.value != token.id }
    }

    func clear() {
        generation += 1
        for task in libraryListTasks.values { task.cancel() }
        libraryListTasks = [:]
        libraryLists = [:]
        libraryListSnapshots = [:]
        libraryListOwners = [:]
    }
}
