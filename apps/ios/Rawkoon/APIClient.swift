import Foundation
import RawkoonKit

enum APIError: Error, Sendable {
    case unauthorized
    case forbidden
    case http(Int)
    case server(status: Int, message: String)
    case decode
    case transport

    static func from(_ failure: HTTPFailure) -> APIError {
        switch failure {
        case .unauthorized: .unauthorized
        case .forbidden: .forbidden
        case let .server(status, message): .server(status: status, message: message)
        case let .http(status): .http(status)
        }
    }

    /// User-visible copy. `unauthorized`/`forbidden` labels vary by screen
    /// (admin gate vs expired session), so callers override those two.
    func userMessage(
        unauthorized: String = String(localized: "Unauthorized. Check your credentials."),
        forbidden: String = String(localized: "You don't have permission to do that."),
        transport: String = String(localized: "Network error. Check your connection.")
    ) -> String {
        switch self {
        case .unauthorized: unauthorized
        case .forbidden: forbidden
        case let .http(status): String(localized: "Server error (\(status)).")
        case let .server(_, message): message
        case .decode: String(localized: "Could not parse server response.")
        case .transport: transport
        }
    }
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
    /// JSON lane: 15s per-request, 60s for the whole resource.
    private let session: URLSession
    /// File downloads (EPUBs): no resource cap, so a large file cannot hit a 20s wall.
    private let downloadSession: URLSession
    /// SSE: request timeout above the 15s server heartbeat, no resource cap.
    private let sseSession: URLSession
    private var token: String?
    /// Fired on an authenticated 401 so `AppModel` can drop the Keychain session.
    private let onUnauthorized: (@Sendable () -> Void)?

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

    init(
        baseURL: URL,
        token: String?,
        onUnauthorized: (@Sendable () -> Void)? = nil
    ) {
        self.baseURL = baseURL
        // Cookie-less ephemeral sessions: a stale better-auth cookie in the
        // shared store makes the sign-in POST arrive "already in a session",
        // which better-auth rejects with 403.
        session = URLSession(configuration: Self.ephemeralConfig(
            requestTimeout: 15,
            resourceTimeout: 60
        ))
        downloadSession = URLSession(configuration: Self.ephemeralConfig(
            requestTimeout: 60,
            resourceTimeout: 0
        ))
        sseSession = URLSession(configuration: Self.ephemeralConfig(
            requestTimeout: 60,
            resourceTimeout: 0
        ))
        self.token = token
        self.onUnauthorized = onUnauthorized
    }

    /// Shared cookie policy; timeouts differ per lane (JSON / download / SSE).
    private static func ephemeralConfig(
        requestTimeout: TimeInterval,
        resourceTimeout: TimeInterval
    ) -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = resourceTimeout
        return config
    }

    /// Public: the enabled OAuth/SSO providers to offer on the login screen.
    func ssoProviders() async throws -> SsoProvidersResponse {
        let request = try makeRequest(path: "/api/auth/sso-providers", method: "GET", requiresAuth: false)
        let (data, response) = try await perform(request)
        try checkStatus(data, response, authenticated: false)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decodeJSON(data, decoder: decoder)
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
        try checkStatus(data, response, authenticated: false)

        if let headerToken = response.value(forHTTPHeaderField: "set-auth-token"), !headerToken.isEmpty {
            token = headerToken
            return headerToken
        }

        let decoder = JSONDecoder()
        let login: LoginTokenResponse
        do {
            login = try decoder.decode(LoginTokenResponse.self, from: data)
        } catch {
            Log.network.error("decode LoginTokenResponse failed: \(String(describing: error), privacy: .public)")
            throw APIError.decode
        }
        guard !login.token.isEmpty else {
            throw APIError.decode
        }

        token = login.token
        return login.token
    }

    func libraryAudiobooks() async throws -> [LibrarySummary] {
        let request = try makeRequest(path: "/api/books", method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        try checkStatus(data, response)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let payload: LibraryResponse = try decodeJSON(data, decoder: decoder)

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
        try checkStatus(data, response)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decodeJSON(data, decoder: decoder)
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
            // A long-lived URLSession reuses keep-alive connections; after the app
            // idles or backgrounds, the server or NAT can drop that socket while the
            // client still believes it is open. The next request over the dead
            // connection fails with -1005 (networkConnectionLost) — the request never
            // reached the server, so retrying an idempotent GET is safe and opens a
            // fresh connection. This is what makes a pull-to-refresh fail while a
            // cold app launch (fresh session) succeeds.
            if request.httpMethod == "GET", Self.isConnectionResetError(error) {
                Log.network.warning(
                    "Retrying GET \(request.url?.path ?? "?", privacy: .public) after transport reset: \(error.localizedDescription, privacy: .public)"
                )
                do {
                    let (data, response) = try await session.data(for: request)
                    guard let http = response as? HTTPURLResponse else {
                        throw APIError.transport
                    }
                    return (data, http)
                } catch let retryError as APIError {
                    throw retryError
                } catch let retryError {
                    Log.network.error(
                        "GET \(request.url?.path ?? "?", privacy: .public) failed after retry: \(retryError.localizedDescription, privacy: .public)"
                    )
                    throw APIError.transport
                }
            }
            Log.network.error(
                "\(request.httpMethod ?? "?", privacy: .public) \(request.url?.path ?? "?", privacy: .public) transport error: \(error.localizedDescription, privacy: .public)"
            )
            throw APIError.transport
        }
    }

    /// Transport failures that mean the request never reached the server over a
    /// stale keep-alive connection, so a single retry on a fresh socket is safe.
    private static func isConnectionResetError(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .networkConnectionLost, .cannotConnectToHost, .timedOut:
            return true
        default:
            return false
        }
    }

    /// Authenticated file download. Carries the bearer header and the cookie-less
    /// session, and maps HTTP status the same way as the JSON lane. Returns the
    /// temporary file URL from URLSession; the caller owns moving it into place.
    func downloadFile(path: String) async throws -> URL {
        let request = try makeRequest(path: path, method: "GET", requiresAuth: true)
        do {
            let (tempURL, response) = try await downloadSession.download(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.transport }
            if !(200 ..< 300).contains(http.statusCode) {
                let data = (try? Data(contentsOf: tempURL)) ?? Data()
                try checkStatus(data, http)
            }
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

    /// Throws unless `response` is 2xx. Authenticated 401 also notifies AppModel
    /// to drop the Keychain session. Decodes `{error}` into `.server` when present.
    func checkStatus(
        _ data: Data,
        _ response: HTTPURLResponse,
        authenticated: Bool = true
    ) throws {
        guard (200 ..< 300).contains(response.statusCode) else {
            let failure = HTTPStatusMapping.failure(status: response.statusCode, body: data)
            if authenticated, failure == .unauthorized {
                onUnauthorized?()
            }
            throw APIError.from(failure)
        }
    }

    private func decodeJSON<T: Decodable>(_ data: Data, decoder: JSONDecoder = mediaDecoder) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            Log.network.error(
                "decode \(String(describing: T.self), privacy: .public) failed: \(String(describing: error), privacy: .public)"
            )
            throw APIError.decode
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
        try checkStatus(data, response)
        return try decodeJSON(data)
    }

    /// Authenticated POST with a JSON body returning a decoded `T`.
    func post<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        let (data, response) = try await sendPost(path, body: body)
        try checkStatus(data, response)
        return try decodeJSON(data)
    }

    /// Authenticated POST that only cares whether the server accepted it (2xx).
    /// Used for grab endpoints whose bodies mix strings and bools.
    func postExpectOK(
        _ path: String,
        body: some Encodable,
        method: String = "POST"
    ) async throws {
        let (data, response) = try await sendPost(path, body: body, method: method)
        try checkStatus(data, response)
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
        try checkStatus(data, response)
        return try decodeJSON(data)
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
        try checkStatus(data, response)
        return try decodeJSON(data)
    }

    /// Authenticated PUT that only cares whether the server accepted it (2xx).
    func putExpectOK(_ path: String, body: some Encodable) async throws {
        let (data, response) = try await sendPut(path, body: body)
        try checkStatus(data, response)
    }

    /// Authenticated PATCH that only cares whether the server accepted it (2xx).
    func patchExpectOK(_ path: String, body: some Encodable) async throws {
        let (data, response) = try await sendPatch(path, body: body)
        try checkStatus(data, response)
    }

    /// Authenticated DELETE returning Void (optionally with query items).
    func deleteExpectOK(_ path: String, query: [String: String?] = [:]) async throws {
        let request = try makeRequest(path: pathWithQuery(path, query), method: "DELETE", requiresAuth: true)
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
    }

    /// Authenticated DELETE returning a decoded body.
    func delete<T: Decodable>(_ path: String) async throws -> T {
        let request = try makeRequest(path: path, method: "DELETE", requiresAuth: true)
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
        return try decodeJSON(data)
    }

    // MARK: Plain-casing helpers (no snake↔camel conversion — Download-Client Hook wire)

    private static let plainDecoder = JSONDecoder()
    private static let plainEncoder = JSONEncoder()

    func getPlain<T: Decodable>(_ path: String) async throws -> T {
        let request = try makeRequest(path: path, method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
        return try decodeJSON(data, decoder: Self.plainDecoder)
    }

    func putPlain<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        var request = try makeRequest(path: path, method: "PUT", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.plainEncoder.encode(body)
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
        return try decodeJSON(data, decoder: Self.plainDecoder)
    }

    func postPlainExpectOK(_ path: String, body: some Encodable) async throws {
        var request = try makeRequest(path: path, method: "POST", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.plainEncoder.encode(body)
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
    }

    /// Consumes a JSON-over-SSE stream at `path`, yielding a decoded value per
    /// `data:` line. Comment/heartbeat lines (`:`-prefixed) and blanks are
    /// skipped, as are lines that fail to decode as `T` (e.g. a handshake
    /// payload shaped differently from the steady-state event — the caller
    /// need not special-case it). A 401 finishes with `APIError.unauthorized`
    /// (and notifies AppModel to log out); a 403 finishes with `.forbidden`.
    /// Cancel the consuming task to close the connection.
    func sseStream<T: Decodable & Sendable>(_ path: String) -> AsyncThrowingStream<T, Error> {
        let session = sseSession
        let token = token
        let base = baseURL
        let onUnauthorized = onUnauthorized
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let url = URL(string: path, relativeTo: base)?.absoluteURL else {
                        throw APIError.transport
                    }
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    if let token, !token.isEmpty {
                        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    }
                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else { throw APIError.transport }
                    if !(200 ..< 300).contains(http.statusCode) {
                        let failure = HTTPStatusMapping.failure(status: http.statusCode, body: Data())
                        if failure == .unauthorized {
                            onUnauthorized?()
                        }
                        throw APIError.from(failure)
                    }
                    let decoder = JSONDecoder()
                    decoder.keyDecodingStrategy = .convertFromSnakeCase
                    for try await line in bytes.lines {
                        if Task.isCancelled {
                            break
                        }
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard !payload.isEmpty, let data = payload.data(using: .utf8) else { continue }
                        if let value = try? decoder.decode(T.self, from: data) {
                            continuation.yield(value)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Migration job status stream. Kept as its own named method (rather than
    /// a bare `sseStream` call at the use site) so `ArrLibraryImportView` reads
    /// the same as before this was generalized.
    func libraryMigrateStatusStream() -> AsyncThrowingStream<MigrateStatusDTO, Error> {
        sseStream("/api/library/migrate/status")
    }

    /// Live library/book change feed. The handshake (`{connected:true,...}`)
    /// decodes but carries no id, so it is filtered out here rather than at
    /// each call site.
    func libraryEventsStream() -> AsyncThrowingStream<LibraryEvent, Error> {
        let raw: AsyncThrowingStream<LibraryEventDTO, Error> = sseStream("/api/library/events")
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in raw {
                        if let bookId = event.bookId, event.kind == "book" {
                            continuation.yield(.book(id: bookId))
                        } else if let mediaId = event.mediaId {
                            continuation.yield(.media(id: mediaId))
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Live per-user notification feed. The handshake (`{connected:true}`)
    /// has no `id`, so it fails to decode as `StreamNotificationDTO` and is
    /// dropped by `sseStream` automatically — no separate filtering needed.
    func notificationStream() -> AsyncThrowingStream<StreamNotificationDTO, Error> {
        sseStream("/api/notifications/stream")
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

    /// Discover deck (swipe)
    func discoverDeck(exclude: [Int], limit: Int = 20, language: String? = nil) async throws -> DiscoverDeckResponse {
        let excludeParam = exclude.isEmpty ? nil : exclude.map(String.init).joined(separator: ",")
        return try await get(
            "/api/medias/discover/deck",
            query: ["limit": String(limit), "exclude": excludeParam, "language": language]
        )
    }

    func dismissDiscover(tmdbId: Int, type: String) async throws {
        nonisolated struct Body: Encodable { let tmdbId: Int; let type: String }
        try await postExpectOK("/api/medias/discover/dismiss", body: Body(tmdbId: tmdbId, type: type))
    }

    func undismissDiscover(tmdbId: Int, type: String) async throws {
        try await deleteExpectOK("/api/medias/discover/dismiss/\(tmdbId)", query: ["type": type])
    }

    /// Explore filter grid
    func discoverGrid(
        type: String,
        providerId: Int? = nil,
        genreId: Int? = nil,
        sortBy: String? = nil,
        page: Int = 1,
        language: String? = nil,
        originalLanguage: String? = nil
    ) async throws -> DiscoverMediasResponse {
        try await get(
            "/api/medias/discover",
            query: [
                "type": type,
                "provider_id": providerId.map(String.init),
                "genre_id": genreId.map(String.init),
                "sort_by": sortBy,
                "page": String(page),
                "language": language,
                "original_language": originalLanguage,
            ]
        )
    }

    func genres(type: String) async throws -> [Genre] {
        let response: GenresResponse = try await get("/api/medias/genres", query: ["type": type])
        return response.genres
    }

    func streamingProviders(type: String) async throws -> [StreamingProvider] {
        let response: StreamingProvidersResponse = try await get(
            "/api/medias/streaming-providers",
            query: ["type": type]
        )
        return response.providers
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
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
    }

    func clearFailedDownloads(libraryId: Int) async throws -> Int {
        let request = try makeRequest(
            path: "/api/library/\(libraryId)/downloads/failed",
            method: "DELETE",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
        let payload: DeleteCountResponse = try decodeJSON(data)
        return payload.deleted
    }

    func deleteDownloadEntry(libraryId: Int, downloadHistoryId: Int) async throws {
        let request = try makeRequest(
            path: "/api/library/\(libraryId)/downloads/\(downloadHistoryId)",
            method: "DELETE",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
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
        let (data, response) = try await postRaw("/api/library/\(libraryId)/downloads/\(downloadHistoryId)/action", body: body)
        try checkStatus(data, response)
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
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
    }

    func libraryEpisodes(id: Int) async throws -> EpisodesResponse {
        try await get("/api/library/\(id)/episodes")
    }

    func libraryFiles(id: Int) async throws -> LibraryFilesResponse {
        try await get("/api/library/\(id)/files")
    }

    func remuxFile(
        fileId: Int,
        keepAudioTrackIndices: [Int],
        keepSubtitleTrackIndices: [Int]
    ) async throws -> RemuxStartResponse {
        try await post(
            "/api/library/files/\(fileId)/remux",
            body: RemuxRequest(
                keepAudioTrackIndices: keepAudioTrackIndices,
                keepSubtitleTrackIndices: keepSubtitleTrackIndices
            )
        )
    }

    func remuxFileStatus(fileId: Int) async throws -> RemuxFileStatus {
        try await get("/api/library/files/\(fileId)/remux/status")
    }

    /// Manual release search + grab (movies). `searchQuery` nil lets the server
    /// fall back to its own title-based queries.
    func searchLibraryItem(id: Int, searchQuery: String? = nil) async throws -> LibrarySearchResponse {
        try await post("/api/library/\(id)/search", body: LibrarySearchBody(searchQuery: searchQuery))
    }

    /// Manual release search + grab for a whole season (best season pack).
    func searchSeason(id: Int, season: Int, searchQuery: String? = nil) async throws -> LibrarySearchResponse {
        try await post(
            "/api/library/\(id)/seasons/\(season)/search",
            body: LibrarySearchBody(searchQuery: searchQuery)
        )
    }

    /// Manual release search + grab for a single episode.
    func searchEpisode(id: Int, episodeId: Int, searchQuery: String? = nil) async throws -> LibrarySearchResponse {
        try await post(
            "/api/library/\(id)/episodes/\(episodeId)/search",
            body: LibrarySearchBody(searchQuery: searchQuery)
        )
    }

    /// Resets every "skipped" episode in a season back to "wanted" so it's picked up again.
    func retrySkippedSeason(id: Int, season: Int) async throws -> Int {
        let response: RetriedResponse = try await post(
            "/api/library/\(id)/seasons/\(season)/retry-skipped",
            body: EmptyBody()
        )
        return response.retried
    }

    func setEpisodeMonitored(id: Int, episodeId: Int, monitored: Bool) async throws -> Bool {
        let response: EpisodeMonitoredResponse = try await patch(
            "/api/library/\(id)/episodes/\(episodeId)/monitored",
            body: UpdateLibraryMonitoredBody(monitored: monitored)
        )
        return response.episode.monitored
    }

    /// Bulk toggle monitoring for every episode in a season. Returns the number of episodes updated.
    func setSeasonMonitored(id: Int, season: Int, monitored: Bool) async throws -> Int {
        let response: SeasonMonitoredResponse = try await patch(
            "/api/library/\(id)/seasons/\(season)/monitored",
            body: UpdateLibraryMonitoredBody(monitored: monitored)
        )
        return response.updated
    }

    /// Resets an episode's status (e.g. "wanted" to retry a skipped episode).
    func setEpisodeStatus(id: Int, episodeId: Int, status: String) async throws -> String {
        let response: EpisodeStatusResponse = try await patch(
            "/api/library/\(id)/episodes/\(episodeId)/status",
            body: UpdateLibraryStatusBody(status: status)
        )
        return response.episode.status
    }

    /// Removes an episode's files (row + disk) and resets it to "wanted".
    func deleteEpisodeFile(id: Int, episodeId: Int) async throws {
        try await deleteExpectOK("/api/library/\(id)/episodes/\(episodeId)", query: ["delete_file": "true"])
    }

    /// Removes a single `MediaFile` row (movies) and its file on disk.
    func deleteMovieFile(fileId: Int) async throws {
        try await deleteExpectOK("/api/library/files/\(fileId)", query: ["delete_file": "true"])
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

    func grabByUrl(libraryId: Int, body: GrabUrlBody) async throws -> LibrarySearchResponse {
        try await post("/api/library/\(libraryId)/grab", body: body)
    }

    /// Whether the Local AI integration is enabled — gates the AI-pick UI.
    func localAiEnabled() async -> Bool {
        do {
            let response: LocalAiIntegrationResponse = try await get("/api/integrations/local-ai")
            return response.integration.enabled
        } catch {
            return false
        }
    }

    /// Fire-and-forget: loads the model into VRAM so the first real pick is fast.
    func aiWarm() async {
        guard let request = try? makeRequest(path: "/api/medias/search/ai-warm", method: "GET", requiresAuth: true) else { return }
        _ = try? await perform(request)
    }

    func aiPick(_ body: AiPickRequest) async throws -> AiPick {
        try await post("/api/medias/search/ai-pick", body: body)
    }

    func blockRelease(_ body: BlocklistBody) async throws {
        try await postExpectOK("/api/medias/blocklist", body: body)
    }

    /// Downloads / activity / calendar
    func downloads(libraryId: Int) async throws -> DownloadsResponse {
        try await get("/api/library/\(libraryId)/downloads")
    }

    func speed() async throws -> SpeedResponse {
        try await get("/api/dashboard/downloads/speed")
    }

    func activityFeed(limit: Int = 50, service: String? = nil, type: String? = nil) async throws -> ActivityFeedResponse {
        try await get("/api/dashboard/activities/feed", query: [
            "limit": String(limit),
            "service": service,
            "type": type,
        ])
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

    /// Notification center (spec §T3) — mirrors the web `/notifications` page.
    /// `read` filters server-side when set; omit it for "all".
    func notifications(
        page: Int? = nil, limit: Int? = nil, read: Bool? = nil
    ) async throws -> NotificationsResponseDTO {
        try await get("/api/notifications", query: [
            "page": page.map(String.init),
            "limit": limit.map(String.init),
            "read": read.map { $0 ? "true" : "false" },
        ])
    }

    func unreadNotificationCount() async throws -> UnreadCountResponseDTO {
        try await get("/api/notifications/unread-count")
    }

    func markNotificationRead(id: Int) async throws {
        try await putExpectOK("/api/notifications/\(id)/read", body: EmptyBody())
    }

    func markAllNotificationsRead() async throws {
        try await putExpectOK("/api/notifications/read-all", body: EmptyBody())
    }

    func deleteNotification(id: Int) async throws {
        try await deleteExpectOK("/api/notifications/\(id)")
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

private nonisolated struct LibrarySearchBody: Encodable {
    let searchQuery: String?
}

private nonisolated struct RetriedResponse: Decodable {
    let retried: Int
}

private nonisolated struct EpisodeMonitoredPayload: Decodable {
    let id: Int
    let monitored: Bool
}

private nonisolated struct EpisodeMonitoredResponse: Decodable {
    let episode: EpisodeMonitoredPayload
}

private nonisolated struct SeasonMonitoredResponse: Decodable {
    let updated: Int
}

private nonisolated struct EpisodeStatusPayload: Decodable {
    let id: Int
    let status: String
    let searchAttempts: Int
}

private nonisolated struct EpisodeStatusResponse: Decodable {
    let episode: EpisodeStatusPayload
}

private nonisolated struct RescanResponse: Decodable {
    let rescanned: Int
    let skipped: Int
    let failed: Int
    let deleted: Int
    let imported: Int
    let requeued: Int
}

nonisolated struct EmptyBody: Encodable {}

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
