import Foundation
import RawkoonKit

extension AppModel {
    func login(server: String, email: String, password: String) async {
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
            let token = try await client.login(email: email, password: password)

            let serverSaved = Keychain.set(normalizedServer, for: Self.serverURLKey)
            let tokenSaved = Keychain.set(token, for: Self.authTokenKey)
            if !serverSaved || !tokenSaved {
                authWarning = Self.persistFailedWarning
            }

            serverURL = normalizedServer
            apiClient = makeAPIClient(baseURL: baseURL, token: token)
            isLoggedIn = true
            try await reloadLibrary()
            requestPushAuthorization()
            startLiveStreams()
            await refreshUnreadNotificationCount()
        } catch {
            errorMessage = message(for: error)
        }
    }

    /// Load the enabled OAuth providers for the login screen (public endpoint).
    func loadSsoProviders() async {
        let raw = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, let base = URL(string: raw) else { ssoProviders = []; return }
        let client = apiClient ?? APIClient(baseURL: base, token: nil)
        ssoProviders = await (try? client.ssoProviders().providers) ?? []
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
        let serverSaved = Keychain.set(server, for: Self.serverURLKey)
        let tokenSaved = Keychain.set(token, for: Self.authTokenKey)
        if !serverSaved || !tokenSaved {
            authWarning = Self.persistFailedWarning
        }
        serverURL = server
        apiClient = makeAPIClient(baseURL: base, token: token)
        isLoggedIn = true
        do { try await reloadLibrary() } catch { errorMessage = message(for: error) }
        requestPushAuthorization()
        startLiveStreams()
        await refreshUnreadNotificationCount()
    }

    /// Authenticated 401 — the Keychain token is stale. Drop the session so
    /// the next frame shows LoginView rather than retrying forever.
    func handleSessionExpired() {
        guard isLoggedIn else { return }
        Log.auth.notice("session expired (401) — signing out")
        logout()
    }

    func makeAPIClient(baseURL: URL, token: String?) -> APIClient {
        serverStateStore.clear()
        return APIClient(baseURL: baseURL, token: token, onUnauthorized: {
            Task { @MainActor in
                AppModel.shared.handleSessionExpired()
            }
        })
    }

    func logout() {
        // Before apiClient is torn down: an APNs token identifies the phone, not
        // the account, so leaving it registered would deliver this user's
        // notifications to whoever signs in next.
        if let token = registeredApnsToken, let client = apiClient {
            Task { try? await client.unregisterApns(deviceToken: token) }
        }
        registeredApnsToken = nil

        stopLiveStreams()
        serverStateStore.clear()
        dismissBanner()
        deepLinkTarget = nil
        liveUpdates.resetUnreadCount()

        // First, while the client can still send the final position; it also
        // drops the Now Playing entry a logged-out app could not serve.
        closePlayer()

        Keychain.delete(Self.serverURLKey)
        Keychain.delete(Self.authTokenKey)

        apiClient = nil
        isLoggedIn = false
        isAdmin = false
        library = []
        manifests = [:]
        downloaders = [:]
        downloadPlans = [:]
        verifiedCounts = [:]
        errorMessage = nil
    }

    /// Refresh admin state on a cold Settings open (or after a promotion/demotion),
    /// since `refreshAdmin()` otherwise only runs on login/library-reload (spec §4.5).
    /// Only ever *adds* admin rows for real admins.
    func refreshAdminIfNeeded() async {
        guard apiClient != nil, !didRefreshAdminOnce else { return }
        didRefreshAdminOnce = true
        await refreshAdmin()
    }

    /// Best-effort: learn whether the signed-in user is an admin, so the UI can
    /// offer "Add to library" (admin) vs "Request" (non-admin).
    func refreshAdmin() async {
        guard let apiClient else { return }
        if let user = await (try? apiClient.currentUser())?.user {
            isAdmin = user.isAdmin ?? false
            let full = [user.firstName, user.lastName].compactMap(\.self).joined(separator: " ")
            userFirstName = user.firstName ?? (full.isEmpty ? user.name : full)
            userInitials = UserInitials.from(firstName: user.firstName, lastName: user.lastName, name: user.name)
        }
    }
}
