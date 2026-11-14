import Foundation
import RawkoonKit

/// The shelves routes: everyone reads, administrators write.
extension APIClient {
    /// The shelves in their window; administrators may ask for the ones outside it too.
    func shelves(includeAll: Bool = false) async throws -> [ShelfSummary] {
        let response: ShelvesResponse = try await get(includeAll ? "/api/shelves?all=1" : "/api/shelves")
        return response.shelves
    }

    /// `includeExcluded` (administrators) also returns titles removed after rules added them, flagged `excluded`.
    func shelf(id: Int, includeExcluded: Bool = false) async throws -> ShelfDetail {
        let response: ShelfResponse = try await get("/api/shelves/\(id)", query: ["excluded": includeExcluded ? "1" : nil])
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

    func removeShelfEntry(shelfId: Int, entryId: Int) async throws {
        try await deleteExpectOK("/api/shelves/\(shelfId)/entries/\(entryId)")
    }

    /// Saves the rules (nil clears them) and returns the shelf as stored.
    func saveShelfRules(id: Int, rules: ShelfRules?) async throws -> ShelfDetail {
        let response: ShelfResponse = try await patch("/api/shelves/\(id)", body: SaveShelfRulesBody(rules: rules))
        return response.shelf
    }

    func setShelfAutoJoin(id: Int, enabled: Bool) async throws -> ShelfDetail {
        let response: ShelfResponse = try await patch("/api/shelves/\(id)", body: ShelfAutoJoinBody(autoJoin: enabled))
        return response.shelf
    }

    /// What unsaved rules would select, without writing anything.
    func previewShelfRules(id: Int, rules: ShelfRules) async throws -> ShelfPreview {
        try await post("/api/shelves/\(id)/preview", body: PreviewShelfRulesBody(rules: rules))
    }

    func seedShelfFromRules(id: Int) async throws -> ShelfDetail {
        let response: ShelfResponse = try await post("/api/shelves/\(id)/seed-from-rules", body: EmptyBody())
        return response.shelf
    }

    /// `kind` is "keywords" or "companies".
    func lookupShelfRule(kind: String, query: String) async throws -> [ShelfLookupItem] {
        let response: ShelfLookupResponse = try await get("/api/shelves/lookup/\(kind)", query: ["q": query])
        return response.items
    }

    /// Which shelves hold a title, for the "Add to shelf" sheet (administrators only).
    func shelvesForTitle(tmdbId: Int, type: String) async throws -> [ShelfMembership] {
        let response: ShelfMembershipsResponse = try await get(
            "/api/shelves/for-title?tmdb_id=\(tmdbId)&type=\(type)"
        )
        return response.shelves
    }
}

private nonisolated struct ShelfEntryResponse: Decodable, Sendable {
    let entry: ShelfEntry
}
