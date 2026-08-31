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
    var id: Int { editionId }
}

/// One book in the merged library list — may have an audiobook edition, an
/// ebook edition, or both (mirrors the web app's merged books view).
struct BookListItem: Identifiable, Sendable {
    let bookId: Int
    let title: String
    let author: String?
    let coverURL: URL?
    let audiobookEditionId: Int?
    let audiobookDurationSecs: Double?
    let hasEbook: Bool
    var id: Int { bookId }

    var hasAudiobook: Bool { audiobookEditionId != nil }

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

    private static let iso8601WithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    init(baseURL: URL, token: String?) {
        self.baseURL = baseURL
        self.session = .shared
        self.token = token
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
        guard (200...299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }

        if let headerToken = response.value(forHTTPHeaderField: "set-auth-token"), !headerToken.isEmpty {
            token = headerToken
            return headerToken
        }

        let decoder = JSONDecoder()
        guard let bodyToken = try? decoder.decode(LoginTokenResponse.self, from: data).token,
              !bodyToken.isEmpty else {
            throw APIError.decode
        }

        token = bodyToken
        return bodyToken
    }

    func libraryAudiobooks() async throws -> [LibrarySummary] {
        let request = try makeRequest(path: "/api/books", method: "GET")
        let (data, response) = try await perform(request)
        guard (200...299).contains(response.statusCode) else {
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
        let request = try makeRequest(path: "/api/books", method: "GET")
        let (data, response) = try await perform(request)
        guard (200...299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let payload: LibraryResponse
        do { payload = try decoder.decode(LibraryResponse.self, from: data) }
        catch { throw APIError.decode }

        return payload.items.map { book in
            let audiobook = book.editions.first { $0.kind == "audiobook" }
            let hasEbook = book.editions.contains { $0.kind == "ebook" }
            return BookListItem(
                bookId: book.id,
                title: book.title,
                author: book.authors.first,
                coverURL: resolveURL(book.coverUrl),
                audiobookEditionId: audiobook?.id,
                audiobookDurationSecs: audiobook?.durationSecs,
                hasEbook: hasEbook
            )
        }
    }

    /// Admin: add a movie/show to the library directly from TMDB.
    func addToLibrary(tmdbId: Int, type: String) async throws {
        struct Body: Encodable { let tmdbId: Int; let type: String }
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

    func manifest(editionId: Int) async throws -> BookManifest {
        let request = try makeRequest(
            path: "/api/books/editions/\(editionId)/manifest",
            method: "GET",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        guard (200...299).contains(response.statusCode) else {
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

    func getProgress() async throws -> [RemoteProgress] {
        let request = try makeRequest(path: "/api/books/progress", method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200...299).contains(response.statusCode) else {
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
        guard (200...299).contains(response.statusCode) else {
            throw mapStatus(response.statusCode)
        }
    }

    private func makeRequest(path: String, method: String, requiresAuth: Bool = false) throws -> URLRequest {
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

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
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

    private func resolveURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let absolute = URL(string: raw), absolute.scheme != nil {
            return absolute
        }
        return URL(string: raw, relativeTo: baseURL)?.absoluteURL
    }

    private func mapStatus(_ status: Int) -> APIError {
        switch status {
        case 401, 403: return .unauthorized
        default: return .http(status)
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
    private static let mediaDecoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    private static let mediaEncoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    /// Authenticated GET returning a decoded `T`. `query` values that are nil are
    /// dropped, so callers can pass optionals directly.
    private func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        let request = try makeRequest(path: pathWithQuery(path, query), method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200..<300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    /// Authenticated POST with a JSON body returning a decoded `T`.
    private func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        let (data, response) = try await sendPost(path, body: body)
        guard (200..<300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    /// Authenticated POST that only cares whether the server accepted it (2xx).
    /// Used for grab endpoints whose bodies mix strings and bools.
    private func postExpectOK<B: Encodable>(_ path: String, body: B) async throws {
        let (_, response) = try await sendPost(path, body: body)
        guard (200..<300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    private func sendPost<B: Encodable>(_ path: String, body: B) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: "POST", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        return try await perform(request)
    }

    private func pathWithQuery(_ path: String, _ query: [String: String?]) -> String {
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

    // Discover
    func explore() async throws -> ExploreFeed {
        try await get("/api/medias/explore")
    }

    func tmdbSearch(q: String, kind: String? = nil) async throws -> TmdbSearchResponse {
        try await get("/api/medias/tmdb-search", query: ["q": q, "kind": kind])
    }

    // Detail
    func mediaModal(mediaType: String, tmdbId: Int) async throws -> MediaModalResponse {
        try await get("/api/medias/modal/\(mediaType)/\(tmdbId)")
    }

    // Library (movies / shows)
    func libraryList(
        type: String? = nil, status: String? = nil, q: String? = nil, limit: Int? = nil,
        sortBy: String? = nil, sortDir: String? = nil
    ) async throws -> LibraryListResponse {
        try await get("/api/library", query: [
            "type": type, "status": status, "q": q,
            "limit": limit.map(String.init),
            "sort_by": sortBy, "sort_dir": sortDir,
        ])
    }

    func libraryEpisodes(id: Int) async throws -> EpisodesResponse {
        try await get("/api/library/\(id)/episodes")
    }

    // Requests
    func requestsList() async throws -> RequestsResponse {
        try await get("/api/requests")
    }

    func createRequest(_ body: CreateRequestBody) async throws -> [String: Int] {
        try await post("/api/requests", body: body)
    }

    // Interactive release search + grab
    func interactiveSearch(
        q: String,
        libraryMediaId: Int? = nil,
        season: Int? = nil,
        tmdbId: Int? = nil,
        mediaType: String? = nil
    ) async throws -> InteractiveSearchResponse {
        try await get("/api/medias/interactive-search", query: [
            "q": q,
            "library_media_id": libraryMediaId.map(String.init),
            "season": season.map(String.init),
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

    // Downloads / activity / calendar
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
        try await get("/api/auth/get-session")
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

    private func putExpectOK<B: Encodable>(_ path: String, body: B) async throws {
        var request = try makeRequest(path: path, method: "PUT", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        let (_, response) = try await perform(request)
        guard (200..<300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }
}

private struct LoginTokenResponse: Decodable {
    let token: String
}

private struct LibraryResponse: Decodable {
    let items: [LibraryBook]
}

private struct LibraryBook: Decodable {
    let id: Int
    let title: String
    let coverUrl: String?
    let authors: [String]
    let editions: [LibraryEdition]
}

private struct LibraryEdition: Decodable {
    let id: Int
    let kind: String
    let status: String
    let durationSecs: Double?
    let fileCount: Int
}

private struct ProgressResponse: Decodable {
    let progress: [ProgressPayload]
}

private struct ProgressPayload: Decodable {
    let editionId: Int
    let positionSecs: Double
    let totalDurationSecs: Double
    let finished: Bool
    let updatedAt: Date
}

private struct PutProgressRequest: Encodable {
    let positionSecs: Double
    let totalDurationSecs: Double
    let finished: Bool
    let updatedAt: Date
    let deviceId: String
}
