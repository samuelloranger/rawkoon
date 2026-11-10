import Foundation

// Generic authenticated request helpers (snake_case JSON lane) shared by every domain extension.

extension APIClient {
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
    func get<T: Decodable>(
        _ path: String,
        query: [String: String?] = [:],
        longWait: Bool = false
    ) async throws -> T {
        let request = try makeRequest(path: pathWithQuery(path, query), method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request, longWait: longWait)
        try checkStatus(data, response)
        return try decodeJSON(data)
    }

    /// Authenticated POST with a JSON body returning a decoded `T`.
    func post<T: Decodable>(_ path: String, body: some Encodable, longWait: Bool = false) async throws -> T {
        let (data, response) = try await sendPost(path, body: body, longWait: longWait)
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
        method: String = "POST",
        longWait: Bool = false
    ) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: method, requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        return try await perform(request, longWait: longWait)
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
}
