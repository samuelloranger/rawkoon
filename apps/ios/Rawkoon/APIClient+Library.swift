import Foundation
import RawkoonKit

extension APIClient {
    func libraryAudiobooks() async throws -> [LibrarySummary] {
        let request = try makeRequest(path: "/api/books", method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200 ... 299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase

        let payload: LibraryResponse
        do {
            payload = try decoder.decode(LibraryResponse.self, from: data)
        } catch {
            throw APIError.decode
        }

        var out: [LibrarySummary] = []
        for book in payload.items {
            for edition in book.editions where edition.kind == "audiobook" {
                out.append(
                    LibrarySummary(
                        editionId: edition.id,
                        bookId: book.id,
                        title: book.title,
                        author: book.authors.first,
                        coverURL: resolveURL(book.coverUrl),
                        durationSecs: edition.durationSecs
                    )
                )
            }
        }
        return out
    }

    /// Admin: add a movie/show to the library directly from TMDB.
    func addToLibrary(tmdbId: Int, type: String) async throws {
        nonisolated struct Body: Encodable { let tmdbId: Int; let type: String }
        try await postExpectOK("/api/library", body: Body(tmdbId: tmdbId, type: type))
    }

    /// Library (movies / shows)
    func libraryList(
        type: String? = nil, status: String? = nil, q: String? = nil, page: Int? = nil, limit: Int? = nil,
        sortBy: String? = nil, sortDir: String? = nil
    ) async throws -> LibraryListResponse {
        try await get("/api/library", query: [
            "type": type, "status": status, "q": q,
            "page": page.map(String.init),
            "limit": limit.map(String.init),
            "sort_by": sortBy, "sort_dir": sortDir,
        ])
    }

    func libraryItem(id: Int) async throws -> LibraryMedia {
        let response: LibraryItemResponse = try await get("/api/library/item/\(id)")
        return response.item
    }

    func updateLibraryMonitored(id: Int, monitored: Bool) async throws -> LibraryMedia {
        let response: LibraryItemResponse = try await patch(
            "/api/library/\(id)/monitored",
            body: UpdateLibraryMonitoredBody(monitored: monitored)
        )
        return response.item
    }

    func updateLibraryStatus(id: Int, status: String) async throws -> LibraryMedia {
        let response: LibraryItemResponse = try await patch(
            "/api/library/\(id)/status",
            body: UpdateLibraryStatusBody(status: status)
        )
        return response.item
    }

    func updateLibraryQualityProfile(id: Int, qualityProfileId: Int?) async throws -> LibraryMedia {
        let response: LibraryItemResponse = try await patch(
            "/api/library/\(id)/quality-profile",
            body: UpdateLibraryQualityProfileBody(qualityProfileId: qualityProfileId)
        )
        return response.item
    }

    func rescanLibraryItem(id: Int) async throws -> (
        rescanned: Int,
        skipped: Int,
        failed: Int,
        deleted: Int,
        imported: Int,
        requeued: Int
    ) {
        let response: RescanResponse = try await post("/api/library/\(id)/rescan", body: EmptyBody())
        return (
            rescanned: response.rescanned,
            skipped: response.skipped,
            failed: response.failed,
            deleted: response.deleted,
            imported: response.imported,
            requeued: response.requeued
        )
    }

    func removeFromLibrary(id: Int, deleteFiles: Bool) async throws {
        let query = deleteFiles ? "?delete_files=true" : ""
        let request = try makeRequest(
            path: "/api/library/\(id)\(query)",
            method: "DELETE",
            requiresAuth: true
        )
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func libraryEpisodes(id: Int) async throws -> EpisodesResponse {
        try await get("/api/library/\(id)/episodes")
    }

    func libraryFiles(id: Int) async throws -> LibraryFilesResponse {
        try await get("/api/library/\(id)/files")
    }

    /// Requests
    func requestsList() async throws -> RequestsResponse {
        try await get("/api/requests")
    }

    func createRequest(_ body: CreateRequestBody) async throws -> [String: Int] {
        try await post("/api/requests", body: body)
    }

    /// Home widgets
    func recentlyAdded(limit: Int = 24) async throws -> LibraryListResponse {
        try await libraryList(limit: limit, sortBy: "added_at", sortDir: "desc")
    }

    func libraryAttention() async throws -> LibraryAttentionResponse {
        try await get("/api/library/attention")
    }
}

nonisolated private struct LibraryItemResponse: Decodable {
    let item: LibraryMedia
}

nonisolated private struct UpdateLibraryMonitoredBody: Encodable {
    let monitored: Bool
}

nonisolated private struct UpdateLibraryStatusBody: Encodable {
    let status: String
}

nonisolated private struct UpdateLibraryQualityProfileBody: Encodable {
    let qualityProfileId: Int?
}

nonisolated private struct RescanResponse: Decodable {
    let rescanned: Int
    let skipped: Int
    let failed: Int
    let deleted: Int
    let imported: Int
    let requeued: Int
}
