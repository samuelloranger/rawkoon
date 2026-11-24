import Foundation
import RawkoonKit

extension SessionStore {
    func login(server: String, email: String, password: String) async {
        await signIn(server: server) { client in
            try await client.login(email: email, password: password)
        }
    }

    func loginWithJellyfin(server: String, username: String, password: String) async {
        await signIn(server: server, errorMessage: jellyfinMessage(for:)) { client in
            try await client.loginWithJellyfin(username: username, password: password)
        }
    }

    /// Status-code copy for a failed Jellyfin sign-in (the body is not relied on).
    func jellyfinMessage(for error: Error) -> String {
        guard let apiError = error as? APIError else { return describeError(error) }
        return JellyfinSignInFailure(apiError: apiError)?.message ?? apiError.userMessage()
    }

    private func signIn(
        server: String,
        errorMessage render: ((Error) -> String)? = nil,
        authenticate: (APIClient) async throws -> String
    ) async {
        let normalizedServer = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let baseURL = URL(string: normalizedServer) else {
            errorMessage = String(localized: "Enter a valid server URL.")
            return
        }

        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            let client = APIClient(baseURL: baseURL, token: nil)
            let token = try await authenticate(client)

            persistCredentials(server: normalizedServer, token: token)
            activate(server: normalizedServer, baseURL: baseURL, token: token)
            try await reloadAfterSignIn()
            await startAfterSignIn()
        } catch {
            errorMessage = (render ?? describeError)(error)
        }
    }

    /// Load the enabled OAuth providers for the login screen (public endpoint).
    func loadSsoProviders() async {
        let raw = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, let base = URL(string: raw) else {
            ssoProviders = []
            jellyfinSignInEnabled = false
            return
        }
        let client = apiClient ?? APIClient(baseURL: base, token: nil)
        let response = try? await client.ssoProviders()
        ssoProviders = response?.providers ?? []
        jellyfinSignInEnabled = response?.jellyfinSignIn ?? false
    }

    /// Login step one: checks that `address` answers as a Rawkoon server, then keeps it and its sign-in options.
    func connect(to address: String) async -> Bool {
        guard let normalized = ServerAddress.normalize(address), let base = URL(string: normalized) else {
            errorMessage = String(localized: "Enter a server address like https://rawkoon.example.com.")
            return false
        }
        errorMessage = nil
        do {
            let response = try await APIClient(baseURL: base, token: nil).ssoProviders()
            serverURL = normalized
            ssoProviders = response.providers
            jellyfinSignInEnabled = response.jellyfinSignIn ?? false
            return true
        } catch {
            let host = ServerAddress.displayName(normalized)
            errorMessage = String(
                localized: "Can't reach a Rawkoon server at \(host). Check the address and that the server is running."
            )
            return false
        }
    }

    /// Sign in through a provider using the native browser OAuth flow.
    func signInWithProvider(_ slug: String) async {
        let raw = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let base = URL(string: raw),
            let startURL = URL(string: "/api/mobile/oauth-start?provider=\(slug)", relativeTo: base)?.absoluteURL
        else {
            errorMessage = String(localized: "Enter a valid server URL.")
            return
        }
        errorMessage = nil
        guard let callback = await WebAuthCoordinator.shared.start(url: startURL, scheme: "rawkoon") else {
            return // cancelled
        }
        let comps = URLComponents(url: callback, resolvingAgainstBaseURL: false)
        if let token = comps?.queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            await applyOAuthToken(server: raw, token: token)
        } else {
            errorMessage = String(localized: "Sign-in failed. Please try again.")
        }
    }

    private func applyOAuthToken(server: String, token: String) async {
        guard let base = URL(string: server) else {
            errorMessage = String(localized: "Enter a valid server URL.")
            return
        }
        persistCredentials(server: server, token: token)
        activate(server: server, baseURL: base, token: token)
        do { try await reloadAfterSignIn() } catch { errorMessage = describeError(error) }
        await startAfterSignIn()
    }
}

nonisolated extension JellyfinSignInFailure {
    /// Nil for errors with no sign-in specific copy (transport, decode, offline).
    init?(apiError: APIError) {
        switch apiError {
        case .unauthorized: self = .wrongCredentials
        case .forbidden: self = .noAccess
        case let .http(status), let .server(status, _): self.init(status: status)
        default: return nil
        }
    }

    /// Nil for `.other`, which falls back to the generic API error copy.
    var message: String? {
        switch self {
        case .wrongCredentials: String(localized: "Wrong Jellyfin username or password.")
        case .noAccess: String(localized: "This Jellyfin account can't sign in to Rawkoon yet. Ask your admin.")
        case .jellyfinUnreachable: String(localized: "Can't reach Jellyfin. Try again in a moment.")
        case .notEnabled: String(localized: "Jellyfin sign-in isn't enabled on this server.")
        case .tooManyAttempts: String(localized: "Too many attempts. Try again in a few minutes.")
        case .other: nil
        }
    }
}
