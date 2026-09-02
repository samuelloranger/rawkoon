import Foundation
import RawkoonKit

extension APIClient {
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

    /// Current session user (better-auth). Best-effort: used to show name/email
    /// and gate admin-only settings rows.
    func currentUser() async throws -> SessionResponse {
        try await get("/api/auth/me")
    }
}

nonisolated private struct LoginTokenResponse: Decodable {
    let token: String
}
