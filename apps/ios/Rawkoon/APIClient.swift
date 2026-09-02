import Foundation
import RawkoonKit

enum APIError: Error, Sendable {
    case unauthorized
    case http(Int)
    case decode
    case transport
}

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
    var id: Int {
        bookId
    }

    var hasAudiobook: Bool {
        audiobookEditionId != nil
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

actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private var token: String?

    /// ISO8601DateFormatter isn't Sendable, but these are configured once here
    /// and never mutated again — only read (parsing/formatting) from any
    /// isolation context afterward, which is safe in practice.
    private nonisolated(unsafe) static let iso8601WithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private nonisolated(unsafe) static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    init(baseURL: URL, token: String?) {
        self.baseURL = baseURL
        // The app authenticates with a bearer token, never cookies. A stale
        // better-auth cookie left in the shared store makes the sign-in POST
        // arrive "already in a session", which better-auth rejects with 403 —
        // so use a cookie-less session that neither stores nor sends cookies.
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        session = URLSession(configuration: config)
        self.token = token
    }

    /// Public: the enabled OAuth/SSO providers to offer on the login screen.
    func ssoProviders() async throws -> SsoProvidersResponse {
        let request = try makeRequest(path: "/api/auth/sso-providers", method: "GET", requiresAuth: false)
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        do { return try decoder.decode(SsoProvidersResponse.self, from: data) }
        catch { throw APIError.decode }
    }

    func login(email: String, password: String) async throws -> String {
        let payload = ["email": email, "password": password]
        let body: Data
        do {
            body = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            throw APIError.transport
        }

        var request = try makeRequest(path: "/api/auth/sign-in/email", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await perform(request)
        guard (200 ... 299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }

        if let headerToken = response.value(forHTTPHeaderField: "set-auth-token"), !headerToken.isEmpty {
            token = headerToken
            return headerToken
        }

        let decoder = JSONDecoder()
        guard let bodyToken = try? decoder.decode(LoginTokenResponse.self, from: data).token,
              !bodyToken.isEmpty
        else {
            throw APIError.decode
        }

        token = bodyToken
        return bodyToken
    }

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

    /// Admin: add a movie/show to the library directly from TMDB.
    func addToLibrary(tmdbId: Int, type: String) async throws {
        nonisolated struct Body: Encodable { let tmdbId: Int; let type: String }
        try await postExpectOK("/api/library", body: Body(tmdbId: tmdbId, type: type))
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
        guard (200 ... 299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }

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

        let (_, response) = try await perform(request)
        guard (200 ... 299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }
    }

    func makeRequest(path: String, method: String, requiresAuth: Bool = false) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw APIError.transport
        }

        var request = URLRequest(url: url)
        request.httpMethod = method

        if requiresAuth {
            guard let token, !token.isEmpty else {
                throw APIError.unauthorized
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return request
    }

    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.transport
            }
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport
        }
    }

    /// Authenticated file download. Carries the bearer header and the cookie-less
    /// session, and maps HTTP status the same way as the JSON lane. Returns the
    /// temporary file URL from URLSession; the caller owns moving it into place.
    func downloadFile(path: String) async throws -> URL {
        let request = try makeRequest(path: path, method: "GET", requiresAuth: true)
        do {
            let (tempURL, response) = try await session.download(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.transport }
            guard (200 ..< 300).contains(http.statusCode) else { throw mapStatus(http.statusCode) }
            return tempURL
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport
        }
    }

    private func resolveURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let absolute = URL(string: raw), absolute.scheme != nil {
            return absolute
        }
        return URL(string: raw, relativeTo: baseURL)?.absoluteURL
    }

    func mapStatus(_ status: Int) -> APIError {
        switch status {
        case 401, 403: .unauthorized
        default: .http(status)
        }
    }

    private static func parseISO8601(_ value: String) -> Date? {
        if let date = iso8601WithFractionalSeconds.date(from: value) {
            return date
        }
        return iso8601.date(from: value)
    }

    // MARK: - Media lane (movies / TV / requests / downloads)

    /// Shared decoder for the media endpoints. snake_case → camelCase; dates
    /// stay as strings (the media DTOs decode them as `String`).
    static let mediaDecoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    static let mediaEncoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    /// Authenticated GET returning a decoded `T`. `query` values that are nil are
    /// dropped, so callers can pass optionals directly.
    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        let request = try makeRequest(path: pathWithQuery(path, query), method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    /// Authenticated POST with a JSON body returning a decoded `T`.
    func post<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        let (data, response) = try await sendPost(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    /// Authenticated POST that only cares whether the server accepted it (2xx).
    /// Used for grab endpoints whose bodies mix strings and bools.
    func postExpectOK(
        _ path: String,
        body: some Encodable,
        method: String = "POST"
    ) async throws {
        let (_, response) = try await sendPost(path, body: body, method: method)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func sendPost(
        _ path: String,
        body: some Encodable,
        method: String = "POST"
    ) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: method, requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        return try await perform(request)
    }

    func patch<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        let (data, response) = try await sendPatch(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    func sendPatch(_ path: String, body: some Encodable) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: "PATCH", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        return try await perform(request)
    }

    // MARK: Generic settings helpers (spec §4.2)

    private func sendPut(_ path: String, body: some Encodable) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: "PUT", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        return try await perform(request)
    }

    /// Authenticated PUT returning a decoded `T` (most `PUT /api/integrations/*`).
    func put<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        let (data, response) = try await sendPut(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    /// Authenticated PUT that only cares whether the server accepted it (2xx).
    func putExpectOK(_ path: String, body: some Encodable) async throws {
        let (_, response) = try await sendPut(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    /// Authenticated PATCH that only cares whether the server accepted it (2xx).
    func patchExpectOK(_ path: String, body: some Encodable) async throws {
        let (_, response) = try await sendPatch(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    /// Authenticated DELETE returning Void (optionally with query items).
    func deleteExpectOK(_ path: String, query: [String: String?] = [:]) async throws {
        let request = try makeRequest(path: pathWithQuery(path, query), method: "DELETE", requiresAuth: true)
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    /// Authenticated DELETE returning a decoded body.
    func delete<T: Decodable>(_ path: String) async throws -> T {
        let request = try makeRequest(path: path, method: "DELETE", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    // MARK: Plain-casing helpers (no snake↔camel conversion — Download-Client Hook wire)

    private static let plainDecoder = JSONDecoder()
    private static let plainEncoder = JSONEncoder()

    func getPlain<T: Decodable>(_ path: String) async throws -> T {
        let request = try makeRequest(path: path, method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.plainDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    func putPlain<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        var request = try makeRequest(path: path, method: "PUT", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.plainEncoder.encode(body)
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.plainDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    func postPlainExpectOK(_ path: String, body: some Encodable) async throws {
        var request = try makeRequest(path: path, method: "POST", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.plainEncoder.encode(body)
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func postRaw(_ path: String, body: [String: Any]) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: "POST", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            throw APIError.transport
        }
        return try await perform(request)
    }

    func pathWithQuery(_ path: String, _ query: [String: String?]) -> String {
        let items = query.compactMap { key, value -> URLQueryItem? in
            guard let value, !value.isEmpty else { return nil }
            return URLQueryItem(name: key, value: value)
        }
        guard !items.isEmpty else { return path }
        var comps = URLComponents()
        comps.queryItems = items.sorted { $0.name < $1.name }
        let q = comps.percentEncodedQuery ?? ""
        return q.isEmpty ? path : "\(path)?\(q)"
    }

    /// Discover
    func explore() async throws -> ExploreFeed {
        try await get("/api/medias/explore")
    }

    func tmdbSearch(q: String, kind: String? = nil) async throws -> TmdbSearchResponse {
        try await get("/api/medias/tmdb-search", query: ["q": q, "kind": kind])
    }

    func bookSearch(q: String) async throws -> BookSearchResponse {
        try await get("/api/books/search", query: ["q": q])
    }

    func addBook(googleVolumeId: String) async throws {
        nonisolated struct Body: Encodable { let googleVolumeId: String }
        try await postExpectOK("/api/books", body: Body(googleVolumeId: googleVolumeId))
    }

    /// Detail
    func mediaModal(mediaType: String, tmdbId: Int) async throws -> MediaModalResponse {
        try await get("/api/medias/modal/\(mediaType)/\(tmdbId)")
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

    func clearFailedDownloads(libraryId: Int) async throws -> Int {
        let request = try makeRequest(
            path: "/api/library/\(libraryId)/downloads/failed",
            method: "DELETE",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        let payload: DeleteCountResponse
        do { payload = try Self.mediaDecoder.decode(DeleteCountResponse.self, from: data) }
        catch { throw APIError.decode }
        return payload.deleted
    }

    func deleteDownloadEntry(libraryId: Int, downloadHistoryId: Int) async throws {
        let request = try makeRequest(
            path: "/api/library/\(libraryId)/downloads/\(downloadHistoryId)",
            method: "DELETE",
            requiresAuth: true
        )
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func downloadAction(
        libraryId: Int,
        downloadHistoryId: Int,
        action: String,
        deleteFiles: Bool = false
    ) async throws {
        let body: [String: Any] = [
            "action": action,
            "delete_files": deleteFiles,
        ]
        let (_, response) = try await postRaw("/api/library/\(libraryId)/downloads/\(downloadHistoryId)/action", body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func similar(tmdbId: Int, mediaType: String, language: String? = nil) async throws -> [TmdbSearchItem] {
        let response: SimilarResponse = try await get("/api/medias/similar/\(tmdbId)", query: [
            "type": mediaType == "tv" ? "tv" : "movie",
            "language": language,
        ])
        return response.items
    }

    func addToWatchlist(
        tmdbId: Int,
        mediaType: String,
        title: String,
        posterURL: String?,
        overview: String?,
        releaseYear: Int?,
        voteAverage: Double?,
        releaseDate: String?
    ) async throws {
        try await postExpectOK("/api/medias/watchlist", body: WatchlistAddBody(
            tmdbId: tmdbId,
            mediaType: mediaType == "tv" ? "tv" : "movie",
            title: title,
            posterUrl: posterURL,
            overview: overview,
            releaseYear: releaseYear,
            voteAverage: voteAverage,
            releaseDate: releaseDate
        ))
    }

    func removeFromWatchlist(tmdbId: Int, mediaType: String) async throws {
        let request = try makeRequest(
            path: "/api/medias/watchlist/\(tmdbId)?type=\(mediaType == "tv" ? "tv" : "movie")",
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

    /// Interactive release search + grab
    func interactiveSearch(
        q: String,
        libraryMediaId: Int? = nil,
        season: Int? = nil,
        complete: Bool = false,
        tmdbId: Int? = nil,
        mediaType: String? = nil
    ) async throws -> InteractiveSearchResponse {
        try await get("/api/medias/interactive-search", query: [
            "q": q,
            "library_media_id": libraryMediaId.map(String.init),
            "season": season.map(String.init),
            "complete": complete ? "true" : nil,
            "tmdb_id": tmdbId.map(String.init),
            "media_type": mediaType,
        ])
    }

    func grabByToken(_ token: String) async throws {
        try await postExpectOK("/api/medias/interactive-search/download", body: GrabTokenBody(token: token))
    }

    func grabByUrl(libraryId: Int, body: GrabUrlBody) async throws {
        try await postExpectOK("/api/library/\(libraryId)/grab", body: body)
    }

    /// Downloads / activity / calendar
    func downloads(libraryId: Int) async throws -> DownloadsResponse {
        try await get("/api/library/\(libraryId)/downloads")
    }

    func speed() async throws -> SpeedResponse {
        try await get("/api/dashboard/downloads/speed")
    }

    func activityFeed(limit: Int = 50) async throws -> ActivityFeedResponse {
        try await get("/api/dashboard/activities/feed", query: ["limit": String(limit)])
    }

    func upcoming() async throws -> UpcomingResponse {
        try await get("/api/dashboard/upcoming")
    }

    /// Home widgets
    func recentlyAdded(limit: Int = 24) async throws -> LibraryListResponse {
        try await libraryList(limit: limit, sortBy: "added_at", sortDir: "desc")
    }

    func nowPlaying() async throws -> NowPlayingResponse {
        try await get("/api/dashboard/jellyfin/now-playing")
    }

    func libraryAttention() async throws -> LibraryAttentionResponse {
        try await get("/api/library/attention")
    }

    func rssStatus() async throws -> RssStatusResponse {
        try await get("/api/library/rss-status")
    }

    /// APNs device registration
    func registerApns(deviceToken: String, deviceName: String?, osVersion: String?, appVersion: String?, bundleId: String?) async throws {
        try await postExpectOK("/api/notifications/apns/register", body: ApnsRegisterBody(
            deviceToken: deviceToken,
            deviceInfo: ApnsDeviceInfo(deviceName: deviceName, osVersion: osVersion, appVersion: appVersion, bundleId: bundleId)
        ))
    }

    /// Drops this device's token on sign-out, so the next account on the phone
    /// does not receive the previous one's notifications.
    func unregisterApns(deviceToken: String) async throws {
        try await postExpectOK(
            "/api/notifications/apns/unregister",
            body: ApnsUnregisterBody(deviceToken: deviceToken)
        )
    }

    // MARK: - Management / settings

    func qualityProfiles() async throws -> QualityProfilesResponse {
        try await get("/api/quality-profiles")
    }

    func indexers() async throws -> IndexersResponse {
        try await get("/api/medias/indexers")
    }

    func downloadClient() async throws -> DownloadClientResponse {
        try await get("/api/integrations/download-client")
    }

    func adminUsers() async throws -> AdminUsersResponse {
        try await get("/api/admin/users")
    }

    func systemVersion() async throws -> SystemVersion {
        try await get("/api/system/version")
    }

    /// Current session user (better-auth). Best-effort: used to show name/email
    /// and gate admin-only settings rows.
    func currentUser() async throws -> SessionResponse {
        try await get("/api/auth/me")
    }

    func approveRequest(id: Int, qualityProfileId: Int) async throws {
        try await postExpectOK("/api/requests/\(id)/approve", body: ApproveRequestBody(qualityProfileId: qualityProfileId))
    }

    func denyRequest(id: Int, reason: String?) async throws {
        try await postExpectOK("/api/requests/\(id)/deny", body: DenyRequestBody(denyReason: reason))
    }

    func updateNotificationPrefs(_ prefs: [String: Bool]) async throws {
        try await putExpectOK("/api/users/me/notification-preferences", body: NotificationPrefsBody(notificationPreferences: prefs))
    }

    private func putExpectOK(_ path: String, body: some Encodable) async throws {
        var request = try makeRequest(path: path, method: "PUT", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }
}

private nonisolated struct LoginTokenResponse: Decodable {
    let token: String
}

private nonisolated struct LibraryResponse: Decodable {
    let items: [LibraryBook]
    let hasMore: Bool?
}

private nonisolated struct LibraryItemResponse: Decodable {
    let item: LibraryMedia
}

private nonisolated struct LibraryBook: Decodable {
    let id: Int
    let title: String
    let coverUrl: String?
    let authors: [String]
    let editions: [LibraryEdition]
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

private nonisolated struct ProgressPayload: Decodable {
    let editionId: Int
    let positionSecs: Double
    let totalDurationSecs: Double
    let finished: Bool
    let updatedAt: Date
}

private nonisolated struct ApnsUnregisterBody: Encodable {
    let deviceToken: String
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

private nonisolated struct SimilarResponse: Decodable {
    let items: [TmdbSearchItem]
}

private nonisolated struct UpdateLibraryMonitoredBody: Encodable {
    let monitored: Bool
}

private nonisolated struct UpdateLibraryStatusBody: Encodable {
    let status: String
}

private nonisolated struct UpdateLibraryQualityProfileBody: Encodable {
    let qualityProfileId: Int?
}

private nonisolated struct DeleteCountResponse: Decodable {
    let deleted: Int
}

private nonisolated struct RescanResponse: Decodable {
    let rescanned: Int
    let skipped: Int
    let failed: Int
    let deleted: Int
    let imported: Int
    let requeued: Int
}

private nonisolated struct EmptyBody: Encodable {}

private nonisolated struct WatchlistAddBody: Encodable {
    let tmdbId: Int
    let mediaType: String
    let title: String
    let posterUrl: String?
    let overview: String?
    let releaseYear: Int?
    let voteAverage: Double?
    let releaseDate: String?
}
