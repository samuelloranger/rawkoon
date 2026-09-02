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
    // `internal` (not `private`) because `login(email:password:)` — which
    // writes this after a successful sign-in — now lives in
    // `APIClient+Auth.swift`; Swift `private` is file-scoped, so a member in
    // one file can't be written by an extension method in another. Actor
    // isolation still protects it exactly as before.
    var token: String?

    // ISO8601DateFormatter isn't Sendable, but these are configured once here
    // and never mutated again — only read (parsing/formatting) from any
    // isolation context afterward, which is safe in practice.
    nonisolated(unsafe) static let iso8601WithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) static let iso8601: ISO8601DateFormatter = {
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

    func resolveURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let absolute = URL(string: raw), absolute.scheme != nil {
            return absolute
        }
        return URL(string: raw, relativeTo: baseURL)?.absoluteURL
    }

    func mapStatus(_ status: Int) -> APIError {
        switch status {
        case 401, 403: return .unauthorized
        default: return .http(status)
        }
    }

    static func parseISO8601(_ value: String) -> Date? {
        if let date = iso8601WithFractionalSeconds.date(from: value) {
            return date
        }
        return iso8601.date(from: value)
    }

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
    func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        let (data, response) = try await sendPost(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    /// Authenticated POST that only cares whether the server accepted it (2xx).
    /// Used for grab endpoints whose bodies mix strings and bools.
    func postExpectOK<B: Encodable>(
        _ path: String,
        body: B,
        method: String = "POST"
    ) async throws {
        let (_, response) = try await sendPost(path, body: body, method: method)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func sendPost<B: Encodable>(
        _ path: String,
        body: B,
        method: String = "POST"
    ) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: method, requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        return try await perform(request)
    }

    func patch<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        let (data, response) = try await sendPatch(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    func sendPatch<B: Encodable>(_ path: String, body: B) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: "PATCH", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        return try await perform(request)
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

    func putExpectOK<B: Encodable>(_ path: String, body: B) async throws {
        var request = try makeRequest(path: path, method: "PUT", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }
}

// MARK: - Shared cross-domain DTOs
//
// Swift `private` visibility is file-scoped. These two types are each used by
// funcs that live in two different domain extension files (Library and
// Books), so they must be `internal` and live in the core file rather than
// duplicated or made file-private to one domain.

/// Decodes the `/api/books` list response, shared by the legacy
/// `libraryAudiobooks()` (Library domain) and the current `libraryBooks()`
/// (Books domain).
nonisolated struct LibraryResponse: Decodable {
    let items: [LibraryBook]
    let hasMore: Bool?
}

nonisolated struct LibraryBook: Decodable {
    let id: Int
    let title: String
    let coverUrl: String?
    let authors: [String]
    let editions: [LibraryEdition]
}

nonisolated struct LibraryEdition: Decodable {
    let id: Int
    let kind: String
    let status: String
    let durationSecs: Double?
    let fileCount: Int
}

/// Empty POST body, shared by `rescanBookEdition` (Books domain) and
/// `rescanLibraryItem` (Library domain).
nonisolated struct EmptyBody: Encodable {}
