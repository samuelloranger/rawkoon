import Foundation
import RawkoonKit

enum APIError: Error, Sendable {
    case unauthorized
    case forbidden
    case http(Int)
    case server(status: Int, message: String)
    case decode
    case transport
    /// The phone has no connection at all — distinct from a server that is down.
    case offline

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
        transport: String = String(localized: "Can't reach the server. Try again in a moment.")
    ) -> String {
        switch self {
        case .unauthorized: unauthorized
        case .forbidden: forbidden
        case let .http(status): String(localized: "Server error (\(status)).")
        case let .server(_, message): message
        case .decode: String(localized: "Could not parse server response.")
        case .transport: transport
        case .offline: String(localized: "You're offline. This needs a connection.")
        }
    }

    /// No HTTP answer at all — the caller may fall back to a cached copy.
    var isNetworkFailure: Bool {
        switch self {
        case .transport, .offline: true
        default: false
        }
    }
}

/// The core API client: an actor owning the URL sessions, auth token, and the
/// shared transport + generic request helpers. Domain methods live in the
/// `APIClient+<Domain>.swift` extension files (Auth, Books, Library, Episodes,
/// Discover, Releases, Activity, Notifications, System, Settings, Requests).
actor APIClient {
    nonisolated let baseURL: URL
    /// JSON lane: 15s per-request, 60s for the whole resource.
    private let session: URLSession
    /// File downloads (EPUBs): no resource cap, so a large file cannot hit a 20s wall.
    private let downloadSession: URLSession
    /// SSE: request timeout above the 15s server heartbeat, no resource cap.
    private let sseSession: URLSession
    /// Re-encode estimates sample-encode clips server-side and send nothing until done.
    private let slowSession: URLSession
    /// Indexer searches and AI picks: a handler can chain up to three 45s indexer queries before answering.
    private let longWaitSession: URLSession
    private static let longWaitRequestTimeout: TimeInterval = 150
    var token: String?
    /// Fired on an authenticated 401 so `AppModel` can drop the Keychain session.
    private let onUnauthorized: (@Sendable () -> Void)?
    /// Disk snapshots of authenticated GETs: screens paint from them first, and
    /// their ETags turn an unchanged refetch into an empty 304.
    nonisolated let responseCache: ResponseCache?

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
        responseCache: ResponseCache? = nil,
        onUnauthorized: (@Sendable () -> Void)? = nil
    ) {
        self.baseURL = baseURL
        self.responseCache = responseCache
        // Cookie-less ephemeral sessions: a stale better-auth cookie in the
        // shared store makes the sign-in POST arrive "already in a session",
        // which better-auth rejects with 403.
        // No URLCache on the JSON lane: `ResponseCache` owns revalidation, and a
        // second cache would answer 304s the app never sees.
        let jsonConfig = Self.ephemeralConfig(requestTimeout: 15, resourceTimeout: 60)
        jsonConfig.urlCache = nil
        jsonConfig.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: jsonConfig)
        downloadSession = URLSession(configuration: Self.ephemeralConfig(
            requestTimeout: 60,
            resourceTimeout: 0
        ))
        sseSession = URLSession(configuration: Self.ephemeralConfig(
            requestTimeout: 60,
            resourceTimeout: 0
        ))
        slowSession = URLSession(configuration: Self.ephemeralConfig(
            requestTimeout: 300,
            resourceTimeout: 600
        ))
        longWaitSession = URLSession(configuration: Self.ephemeralConfig(
            requestTimeout: Self.longWaitRequestTimeout,
            resourceTimeout: 180
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

    func perform(
        _ request: URLRequest,
        longWait: Bool = false,
        timeout: TimeInterval? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        let key = cacheKey(for: request)
        var request = request
        let cached = key.flatMap { responseCache?.entry(for: $0) }
        if let etag = cached?.etag {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }
        let (data, http) = try await send(request, longWait: longWait, timeout: timeout)
        guard let key, let responseCache else { return (data, http) }
        if http.statusCode == 304, let cached {
            responseCache.markRevalidated(key)
            return (cached.data, Self.revalidatedResponse(from: http))
        }
        if http.statusCode == 200 {
            responseCache.store(data, etag: http.value(forHTTPHeaderField: "ETag"), for: key)
        }
        return (data, http)
    }

    /// Only authenticated GETs are persisted: they are what screens browse, and
    /// the cache is wiped on sign-out along with the token that fetched them.
    private func cacheKey(for request: URLRequest) -> String? {
        guard
            request.httpMethod == "GET",
            request.value(forHTTPHeaderField: "Authorization") != nil,
            let url = request.url
        else { return nil }
        return cacheKey(for: url)
    }

    private nonisolated func cacheKey(for url: URL) -> String? {
        guard responseCache != nil else { return nil }
        let path = url.query.map { "\(url.path)?\($0)" } ?? url.path
        return ResponseCachePolicy.isCacheable(path: path) ? path : nil
    }

    // MARK: - Cached reads (no network)

    /// The raw body last stored for `path` + `query`, or nil.
    nonisolated func cachedEntry(_ path: String, query: [String: String?] = [:]) -> ResponseCache.Entry? {
        guard
            let url = URL(string: pathWithQuery(path, query), relativeTo: baseURL)?.absoluteURL,
            let key = cacheKey(for: url)
        else { return nil }
        return responseCache?.entry(for: key)
    }

    /// The response last stored for `path` + `query`, decoded — what a screen
    /// paints before its refetch lands. Nil when never fetched or undecodable.
    nonisolated func cached<T: Decodable>(
        _ path: String,
        query: [String: String?] = [:],
        decoder: JSONDecoder = mediaDecoder
    ) -> Cached<T>? {
        guard
            let entry = cachedEntry(path, query: query),
            let value = try? decoder.decode(T.self, from: entry.data)
        else { return nil }
        return Cached(value: value, fetchedAt: entry.fetchedAt)
    }

    /// A 304 stands in for the cached 200, so callers' status checks pass.
    private static func revalidatedResponse(from http: HTTPURLResponse) -> HTTPURLResponse {
        let headers = http.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            if let key = pair.key as? String, let value = pair.value as? String {
                result[key] = value
            }
        }
        return HTTPURLResponse(
            url: http.url ?? URL(fileURLWithPath: "/"),
            statusCode: 200,
            httpVersion: nil,
            headerFields: headers
        ) ?? http
    }

    private func send(
        _ request: URLRequest,
        longWait: Bool,
        timeout: TimeInterval? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        let lane = longWait ? longWaitSession : session
        var request = request
        // Pinned on the request too, so the 60s URLRequest default can never cap the long lane.
        if longWait {
            request.timeoutInterval = Self.longWaitRequestTimeout
        }
        // Applied last so a caller can tighten the lane's default.
        if let timeout {
            request.timeoutInterval = timeout
        }
        do {
            let (data, response) = try await lane.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.transport
            }
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch {
            if Self.isOffline(error) {
                throw APIError.offline
            }
            // A long-lived URLSession reuses keep-alive connections; after the app
            // idles or backgrounds, the server or NAT can drop that socket while the
            // client still believes it is open. The next request over the dead
            // connection fails with -1005 (networkConnectionLost) — the request never
            // reached the server, so retrying an idempotent GET is safe and opens a
            // fresh connection. This is what makes a pull-to-refresh fail while a
            // cold app launch (fresh session) succeeds.
            if Self.shouldRetry(after: error, method: request.httpMethod, longWait: longWait) {
                Log.network.warning(
                    "Retrying GET \(request.url?.path ?? "?", privacy: .public) after transport reset: \(error.localizedDescription, privacy: .public)"
                )
                do {
                    let (data, response) = try await lane.data(for: request)
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
                    throw Self.isOffline(retryError) ? APIError.offline : APIError.transport
                }
            }
            Log.network.error(
                "\(request.httpMethod ?? "?", privacy: .public) \(request.url?.path ?? "?", privacy: .public) transport error: \(error.localizedDescription, privacy: .public)"
            )
            throw APIError.transport
        }
    }

    private static func isOffline(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        return NetworkFailure.classify(urlErrorCode: urlError.code.rawValue) == .offline
    }

    /// Whether a GET that failed in transport is retried once on a fresh socket:
    /// these failures mean it likely never reached the server over a stale
    /// keep-alive connection. A timeout on the long-wait lane means the server
    /// was still working, so a retry would only double the wait and its search.
    static func shouldRetry(after error: Error, method: String?, longWait: Bool) -> Bool {
        guard method == "GET", let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .networkConnectionLost, .cannotConnectToHost:
            return true
        case .timedOut:
            return !longWait
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

    nonisolated func resolveURL(_ raw: String?) -> URL? {
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

    /// Long-timeout lane for requests the server answers only after minutes of work.
    func performSlow(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await slowSession.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.transport
            }
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch {
            Log.network.error("slow request failed: \(error.localizedDescription, privacy: .public)")
            throw APIError.transport
        }
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

    nonisolated func pathWithQuery(_ path: String, _ query: [String: String?]) -> String {
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

nonisolated struct EmptyBody: Encodable {}

/// A value read from `ResponseCache`, with when the server last confirmed it.
nonisolated struct Cached<Value> {
    let value: Value
    let fetchedAt: Date
}

extension Cached: Sendable where Value: Sendable {}
