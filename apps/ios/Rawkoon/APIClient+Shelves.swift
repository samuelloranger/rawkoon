import Foundation
import RawkoonKit

/// The shelves routes: everyone reads, administrators write.
extension APIClient {
    /// The shelves in their window; administrators may ask for the ones outside it too.
    func shelves(includeAll: Bool = false) async throws -> [ShelfSummary] {
        let response: ShelvesResponse = try await get(includeAll ? "/api/shelves?all=1" : "/api/shelves")
        return response.shelves
    }

    func shelf(id: Int) async throws -> ShelfDetail {
        let response: ShelfResponse = try await get("/api/shelves/\(id)")
        return response.shelf
    }

    func createShelf(name: String) async throws -> ShelfDetail {
        let response: ShelfResponse = try await post("/api/shelves", body: CreateShelfBody(name: name, seed: nil))
        return response.shelf
    }

    func createShelf(seed: String) async throws -> ShelfDetail {
        let response: ShelfResponse = try await post("/api/shelves", body: CreateShelfBody(name: nil, seed: seed))
        return response.shelf
    }

    func updateShelf(id: Int, body: UpdateShelfBody) async throws -> ShelfDetail {
        let response: ShelfResponse = try await patch("/api/shelves/\(id)", body: body)
        return response.shelf
    }

    func deleteShelf(id: Int) async throws {
        try await deleteExpectOK("/api/shelves/\(id)")
    }

    func reorderShelves(ids: [Int]) async throws {
        try await putExpectOK("/api/shelves/order", body: ReorderShelvesBody(ids: ids))
    }

    func shelfSeeds() async throws -> [ShelfSeed] {
        let language = (Locale.preferredLanguages.first ?? "en").prefix(2)
        let response: ShelfSeedsResponse = try await get("/api/shelves/seeds?lang=\(language)")
        return response.seeds
    }

    /// Adds a whole title (or one of a show's seasons) to a shelf.
    @discardableResult
    func addShelfEntry(shelfId: Int, tmdbId: Int, type: String, season: Int? = nil) async throws -> ShelfEntry {
        let response: ShelfEntryResponse = try await post(
            "/api/shelves/\(shelfId)/entries",
            body: AddShelfEntryBody(tmdbId: tmdbId, type: type, season: season)
        )
        return response.entry
    }

    /// Saves the display order and the group header of every entry, in order.
    func moveShelfEntries(shelfId: Int, entries: [ShelfEntry]) async throws {
        let body = MoveShelfEntryBody(entries: entries.enumerated().map { position, entry in
            MoveShelfEntry(id: entry.id, position: position, groupLabel: entry.groupLabel)
        })
        try await patchExpectOK("/api/shelves/\(shelfId)/entries", body: body)
    }

    /// Sets one entry's group header without touching the others' order.
    func setShelfEntryGroup(shelfId: Int, entry: ShelfEntry, label: String?) async throws {
        let body = MoveShelfEntryBody(entries: [
            MoveShelfEntry(id: entry.id, position: entry.position, groupLabel: label),
        ])
        try await patchExpectOK("/api/shelves/\(shelfId)/entries", body: body)
    }

    func removeShelfEntry(shelfId: Int, entryId: Int) async throws {
        try await deleteExpectOK("/api/shelves/\(shelfId)/entries/\(entryId)")
    }

    /// Which shelves hold a title, for the "Add to shelf" sheet (administrators only).
    func shelvesForTitle(tmdbId: Int, type: String) async throws -> [ShelfMembership] {
        let response: ShelfMembershipsResponse = try await get(
            "/api/shelves/for-title?tmdb_id=\(tmdbId)&type=\(type)"
        )
        return response.shelves
    }
}

private nonisolated struct ReorderShelvesBody: Encodable, Sendable {
    let ids: [Int]
}

private nonisolated struct ShelfEntryResponse: Decodable, Sendable {
    let entry: ShelfEntry
}
