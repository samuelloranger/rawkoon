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
