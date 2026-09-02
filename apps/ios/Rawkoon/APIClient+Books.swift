import Foundation
import RawkoonKit

extension APIClient {
    /// All books, merged: audiobooks and ebooks in one list (like the web app).
    func libraryBooks() async throws -> [BookListItem] {
        var page = 1
        let limit = 100
        var allItems: [BookListItem] = []

        while true {
            let request = try makeRequest(
                path: pathWithQuery("/api/books", [
                    "page": String(page),
                    "limit": String(limit),
                ]),
                method: "GET",
                requiresAuth: true
            )
            let (data, response) = try await perform(request)
            guard (200 ... 299).contains(response.statusCode) else {
                throw mapStatus(response.statusCode)
            }
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let payload: LibraryResponse
            do { payload = try decoder.decode(LibraryResponse.self, from: data) }
            catch { throw APIError.decode }

            let pageItems = payload.items.map { book in
                let audiobook = book.editions.first { $0.kind == "audiobook" }
                let ebook = book.editions.first { $0.kind == "ebook" }
                return BookListItem(
                    bookId: book.id,
                    title: book.title,
                    author: book.authors.first,
                    coverURL: resolveURL(book.coverUrl),
                    audiobookEditionId: audiobook?.id,
                    ebookEditionId: ebook?.id,
                    audiobookDurationSecs: audiobook?.durationSecs,
                    audiobookStatus: audiobook?.status,
                    audiobookFileCount: audiobook?.fileCount ?? 0,
                    hasEbook: ebook != nil
                )
            }
            allItems.append(contentsOf: pageItems)

            if payload.hasMore != true || pageItems.isEmpty {
                break
            }
            page += 1
        }

        return allItems
    }

    // MARK: Book editions (add an audiobook edition onto an existing book)

    func addBookEdition(bookId: Int, kind: String) async throws {
        try await postExpectOK("/api/books/\(bookId)/editions", body: CreateBookEditionBody(kind: kind, monitored: true))
    }

    func bookReleaseSearch(bookId: Int, kind: String) async throws -> BookReleasesResponse {
        try await get("/api/books/\(bookId)/editions/\(kind)/search")
    }

    func bookGrab(bookId: Int, kind: String, body: BookGrabBody) async throws {
        try await postExpectOK("/api/books/\(bookId)/editions/\(kind)/grab", body: body)
    }

    func rescanBookEdition(bookId: Int, kind: String) async throws -> BookEditionRescanResponse {
        try await post("/api/books/\(bookId)/editions/\(kind)/rescan", body: EmptyBody())
    }

    func manifest(editionId: Int) async throws -> BookManifest {
        let request = try makeRequest(
            path: "/api/books/editions/\(editionId)/manifest",
            method: "GET",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        guard (200 ... 299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        do {
            return try decoder.decode(BookManifest.self, from: data)
        } catch {
            throw APIError.decode
        }
    }

    func bookDetail(bookId: Int) async throws -> BookDetailItem {
        let response: BookDetailResponse = try await get("/api/books/\(bookId)")
        return response.item
    }

    func bookEditionFiles(bookId: Int, kind: String) async throws -> [BookEditionFile] {
        let response: BookEditionFilesPayload = try await get("/api/books/\(bookId)/editions/\(kind)/files")
        return response.files
    }

    func readingProgress() async throws -> [ReadingPosition] {
        let payload: ReadingProgressResponse = try await get("/api/books/reading-progress")
        return payload.progress.compactMap { row in
            guard let updatedAt = APIClient.parseISO8601(row.updatedAt) else { return nil }
            return ReadingPosition(
                editionId: row.editionId,
                fileId: row.fileId,
                spineIndex: row.spineIndex,
                spinePath: row.spinePath,
                spineCount: row.spineCount,
                scrollFraction: row.scrollFraction,
                finished: row.finished,
                updatedAtMillis: Int64((updatedAt.timeIntervalSince1970 * 1000).rounded()),
                locator: row.locator
            )
        }
    }

    func putReadingProgress(_ position: ReadingPosition, deviceId: String) async throws {
        let updatedAt = Date(timeIntervalSince1970: Double(position.updatedAtMillis) / 1000)
        try await postExpectOK(
            "/api/books/editions/\(position.editionId)/reading-progress",
            body: PutReadingProgressRequest(
                fileId: position.fileId,
                spineIndex: position.spineIndex,
                spinePath: position.spinePath,
                spineCount: position.spineCount,
                scrollFraction: position.scrollFraction,
                finished: position.finished,
                updatedAt: APIClient.iso8601WithFractionalSeconds.string(from: updatedAt),
                deviceId: deviceId,
                locator: position.locator
            ),
            method: "PUT"
        )
    }

    func getProgress() async throws -> [RemoteProgress] {
        let request = try makeRequest(path: "/api/books/progress", method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200 ... 299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            guard let parsed = APIClient.parseISO8601(value) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date: \(value)")
            }
            return parsed
        }

        let payload: ProgressResponse
        do {
            payload = try decoder.decode(ProgressResponse.self, from: data)
        } catch {
            throw APIError.decode
        }

        return payload.progress.map {
            RemoteProgress(
                editionId: $0.editionId,
                positionSecs: $0.positionSecs,
                totalDurationSecs: $0.totalDurationSecs,
                finished: $0.finished,
                updatedAt: $0.updatedAt
            )
        }
    }

    func putProgress(
        editionId: Int,
        positionSecs: Double,
        totalDurationSecs: Double,
        finished: Bool,
        updatedAt: Date,
        deviceId: String
    ) async throws {
        let bodyModel = PutProgressRequest(
            positionSecs: positionSecs,
            totalDurationSecs: totalDurationSecs,
            finished: finished,
            updatedAt: updatedAt,
            deviceId: deviceId
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(APIClient.iso8601WithFractionalSeconds.string(from: date))
        }

        let body: Data
        do {
            body = try encoder.encode(bodyModel)
        } catch {
            throw APIError.transport
        }

        var request = try makeRequest(
            path: "/api/books/editions/\(editionId)/progress",
            method: "PUT",
            requiresAuth: true
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (_, response) = try await perform(request)
        guard (200 ... 299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }
    }

    func bookSearch(q: String) async throws -> BookSearchResponse {
        try await get("/api/books/search", query: ["q": q])
    }

    func addBook(googleVolumeId: String) async throws {
        nonisolated struct Body: Encodable { let googleVolumeId: String }
        try await postExpectOK("/api/books", body: Body(googleVolumeId: googleVolumeId))
    }
}

nonisolated struct BookEditionRescanResponse: Decodable, Sendable {
    let registered: Int
    let refreshed: Int
    let removed: Int
    let directory: String?
}

private nonisolated struct ProgressResponse: Decodable {
    let progress: [ProgressPayload]
}

private nonisolated struct ProgressPayload: Decodable {
    let editionId: Int
    let positionSecs: Double
    let totalDurationSecs: Double
    let finished: Bool
    let updatedAt: Date
}

private nonisolated struct ReadingProgressResponse: Decodable {
    let progress: [ReadingProgressPayload]
}

/// `updatedAt` stays a String here: the shared media decoder does not install a
/// date strategy, so it is parsed explicitly.
private nonisolated struct ReadingProgressPayload: Decodable {
    let editionId: Int
    let fileId: Int?
    let spineIndex: Int
    let spinePath: String
    let spineCount: Int
    let scrollFraction: Double
    let finished: Bool
    let updatedAt: String
    let locator: String?
}

private nonisolated struct PutReadingProgressRequest: Encodable {
    let fileId: Int?
    let spineIndex: Int
    let spinePath: String
    let spineCount: Int
    let scrollFraction: Double
    let finished: Bool
    let updatedAt: String
    let deviceId: String
    let locator: String?
}

private nonisolated struct PutProgressRequest: Encodable {
    let positionSecs: Double
    let totalDurationSecs: Double
    let finished: Bool
    let updatedAt: Date
    let deviceId: String
}
