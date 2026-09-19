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

/// The core API client: an actor owning the URL sessions, auth token, and the
/// shared transport + generic request helpers. Domain methods live in the
/// `APIClient+<Domain>.swift` extension files (Books, Media, Notifications,
/// System, Settings).
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
    nonisolated(unsafe) static let iso8601WithFractionalSeconds: ISO8601DateFormatter = {
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

    // MARK: - Auth / session

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

    /// Current session user (better-auth). Best-effort: used to show name/email
    /// and gate admin-only settings rows.
    func currentUser() async throws -> SessionResponse {
        try await get("/api/auth/me")
    }

    /// The `title_language` the library endpoints localize stored titles in, and
    /// the TMDB `language` the discover/search endpoints forward. Both follow the
    /// in-app language override (see `AppLanguage`), which defaults to the device
    /// locale. Anything but French collapses to English, the server's default.
    static var titleLanguage: String {
        AppLanguage.resolvedTitleCode
    }

    static var tmdbLanguage: String {
        AppLanguage.resolvedTmdbLanguage
    }

    // MARK: - Transport

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

    func resolveURL(_ raw: String?) -> URL? {
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

    func decodeJSON<T: Decodable>(_ data: Data, decoder: JSONDecoder = mediaDecoder) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            Log.network.error(
                "decode \(String(describing: T.self), privacy: .public) failed: \(String(describing: error), privacy: .public)"
            )
            throw APIError.decode
        }
    }

    static func parseISO8601(_ value: String) -> Date? {
        if let date = iso8601WithFractionalSeconds.date(from: value) {
            return date
        }
        return iso8601.date(from: value)
    }

    // MARK: - Generic request helpers

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

    // MARK: - SSE

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

    // MARK: - Low-level helpers

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
}

private nonisolated struct LoginTokenResponse: Decodable {
    let token: String
}

nonisolated struct EmptyBody: Encodable {}
