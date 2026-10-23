import Foundation

// Sign-in and session endpoints: SSO provider list, email login, current user.

extension APIClient {
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
        try await signIn(path: "/api/auth/sign-in/email", payload: ["email": email, "password": password])
    }

    /// Jellyfin credentials, checked server-side against the configured Jellyfin.
    /// Failures arrive as plain status codes; see `JellyfinSignInFailure`.
    func loginWithJellyfin(username: String, password: String) async throws -> String {
        try await signIn(path: "/api/auth/sign-in/jellyfin", payload: ["username": username, "password": password])
    }

    private func signIn(path: String, payload: [String: String]) async throws -> String {
        let body: Data
        do {
            body = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            throw APIError.transport
        }

        var request = try makeRequest(path: path, method: "POST")
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
        try await get(Endpoints.currentUser)
    }
}

private nonisolated struct LoginTokenResponse: Decodable {
    let token: String
}
