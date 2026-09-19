import Foundation
import RawkoonKit

// Book/audiobook/ebook API methods + their DTOs. Split out of APIClient.swift
// to stay under the file_length lint threshold (spec §4.2).

struct LibrarySummary: Identifiable, Sendable {
    let editionId: Int
    let bookId: Int
    let title: String
    let author: String?
    let coverURL: URL?
    let durationSecs: Double?
    var id: Int {
        editionId
    }
}

/// One book in the merged library list — may have an audiobook edition, an
/// ebook edition, or both (mirrors the web app's merged books view).
struct BookListItem: Identifiable, Sendable {
    let bookId: Int
    let title: String
    let author: String?
    let coverURL: URL?
    let audiobookEditionId: Int?
    let ebookEditionId: Int?
    let audiobookDurationSecs: Double?
    let audiobookStatus: String?
    let audiobookFileCount: Int
    let hasEbook: Bool
    let readAt: String?
    var id: Int {
        bookId
    }

    var hasAudiobook: Bool {
        audiobookEditionId != nil
    }

    var isRead: Bool {
        readAt != nil
    }

    /// A playable summary for the audiobook edition, when present.
    var audiobookSummary: LibrarySummary? {
        guard let editionId = audiobookEditionId else { return nil }
        return LibrarySummary(
            editionId: editionId, bookId: bookId, title: title,
            author: author, coverURL: coverURL, durationSecs: audiobookDurationSecs
        )
    }
}

struct RemoteProgress: Sendable {
    let editionId: Int
    let positionSecs: Double
    let totalDurationSecs: Double
    let finished: Bool
    let updatedAt: Date
}

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
            try checkStatus(data, response)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let payload: LibraryResponse = try decodeJSON(data, decoder: decoder)

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
                    hasEbook: ebook != nil,
                    readAt: book.readAt
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
        try checkStatus(data, response)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decodeJSON(data, decoder: decoder)
    }

    func bookDetail(bookId: Int) async throws -> BookDetailItem {
        let response: BookDetailResponse = try await get("/api/books/\(bookId)")
        return response.item
    }

    func setBookRead(bookId: Int, read: Bool) async throws {
        try await putExpectOK("/api/books/\(bookId)/read", body: SetBookReadBody(read: read))
    }

    func bookEditionFiles(bookId: Int, kind: String) async throws -> [BookEditionFile] {
        let response: BookEditionFilesPayload = try await get("/api/books/\(bookId)/editions/\(kind)/files")
        return response.files
    }

    func readingProgress() async throws -> [ReadingPosition] {
        let payload: ReadingProgressResponse = try await get("/api/books/reading-progress")
        return payload.progress.compactMap { row in
            guard let updatedAt = Self.parseISO8601(row.updatedAt) else { return nil }
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
                updatedAt: Self.iso8601WithFractionalSeconds.string(from: updatedAt),
                deviceId: deviceId,
                locator: position.locator
            ),
            method: "PUT"
        )
    }

    func getProgress() async throws -> [RemoteProgress] {
        let request = try makeRequest(path: "/api/books/progress", method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        try checkStatus(data, response)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            guard let parsed = Self.parseISO8601(value) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date: \(value)")
            }
            return parsed
        }

        let payload: ProgressResponse = try decodeJSON(data, decoder: decoder)

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
            try container.encode(Self.iso8601WithFractionalSeconds.string(from: date))
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

        let (data, response) = try await perform(request)
        try checkStatus(data, response)
    }

    func bookSearch(q: String) async throws -> BookSearchResponse {
        try await get("/api/books/search", query: ["q": q])
    }

    func addBook(googleVolumeId: String) async throws {
        nonisolated struct Body: Encodable { let googleVolumeId: String }
        try await postExpectOK("/api/books", body: Body(googleVolumeId: googleVolumeId))
    }

    /// Book discovery (Explore): configured sources and a ranked list.
    func bookDiscoverySources() async throws -> BookDiscoverySourcesResponse {
        try await get("/api/books/discovery/sources")
    }

    func bookDiscovery(source: String, list: String) async throws -> BookDiscoveryResponse {
        try await get("/api/books/discovery", query: ["source": source, "list": list])
    }

    /// Add a discovered book. Sends scraped metadata so a title Google Books does
    /// not index is still created; the server prefers a Google volume when present.
    func addDiscoveryBook(_ book: BookDiscoveryBook) async throws {
        nonisolated struct Body: Encodable {
            let volumeId: String?
            let isbn13: String?
            let title: String
            let author: String?
            let overview: String?
            let coverUrl: String?
            let publishedYear: Int?
        }
        try await postExpectOK(
            "/api/books/discovery/add",
            body: Body(
                volumeId: book.volumeId,
                isbn13: book.isbn13,
                title: book.title,
                author: book.author,
                overview: book.overview,
                coverUrl: book.coverUrl,
                publishedYear: book.publishedYear
            )
        )
    }

    func listeningStats() async throws -> ListeningStats {
        try await get("/api/books/listening-stats")
    }
}

private nonisolated struct LibraryResponse: Decodable {
    let items: [LibraryBook]
    let hasMore: Bool?
}

private nonisolated struct LibraryBook: Decodable {
    let id: Int
    let title: String
    let coverUrl: String?
    let authors: [String]
    let editions: [LibraryEdition]
    let readAt: String?
}

private nonisolated struct LibraryEdition: Decodable {
    let id: Int
    let kind: String
    let status: String
    let durationSecs: Double?
    let fileCount: Int
}

private nonisolated struct ProgressResponse: Decodable {
    let progress: [ProgressPayload]
}

nonisolated struct BookEditionRescanResponse: Decodable, Sendable {
    let registered: Int
    let refreshed: Int
    let removed: Int
    let directory: String?
}

private nonisolated struct SetBookReadBody: Encodable {
    let read: Bool
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
