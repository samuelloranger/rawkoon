import Foundation
import Observation
import RawkoonKit
import UIKit

/// Owns who is signed in and against which server: credentials, the API client,
/// the profile painted from `/api/auth/me`, the server's feature switches and the
/// APNs token bookkeeping. Cross-domain follow-ups (library reload, live streams,
/// scope adoption) reach it through the hooks `AppModel.init` wires.
@MainActor
@Observable
final class SessionStore {
    static let serverURLKey = "server_url"
    static let authTokenKey = "auth_token"
    private static let deviceIDKey = "device_id"

    static let persistFailedWarning = String(localized: "Signed in, but this device couldn't save your login. You may need to sign in again after quitting the app.")

    var isLoggedIn = false
    var serverURL: String
    var apiClient: APIClient?
    var isAdmin = false
    /// The signed-in user's id, to tell their own requests from others'.
    var userId: String?
    /// Mirrors the server's books feature flag; stays on until the server says otherwise.
    var booksEnabled = true
    /// The server's add-dialog switches; off until the server says otherwise, so a failed fetch keeps the instant add.
    var askBeforeAdding = false
    var requestersChooseSeasons = false
    var userFirstName: String?
    var userInitials: String?
    var userAvatarURL: URL?
    var ssoProviders: [SsoProvider] = []
    var jellyfinSignInEnabled = false
    var loading = false
    var errorMessage: String?
    /// Set when sign-in succeeded but the credential could not be written to the
    /// Keychain — the session works now but will not survive a relaunch. Surfaced
    /// as an alert at the app root, distinct from `errorMessage` (a login failure).
    var authWarning: String?
    /// The in-flight `/api/auth/me` fetch, so launch, Settings and a reconnect
    /// share one request.
    var profileTask: Task<Void, Never>?
    var pendingApnsToken: String?
    /// Retained after registration so sign-out can unregister it.
    var registeredApnsToken: String?
    var didRefreshAdminOnce = false
    /// Not `let`: before the first unlock the Keychain is unreadable, so the
    /// launch value can be provisional until protected data becomes available.
    private(set) var deviceID: String

    // MARK: Hooks wired by AppModel.init

    /// A 401 on an authenticated request: the owner signs the session out.
    var onSessionExpired: () -> Void = {}
    /// First step after credentials are saved; a throw is shown as the sign-in error.
    var reloadAfterSignIn: () async throws -> Void = {}
    /// Everything else a fresh sign-in starts (push, live streams, unread count).
    var startAfterSignIn: () async -> Void = {}
    /// Runs once the signed-in user's id is known, before the name fields are set.
    var didIdentifyUser: (String) -> Void = { _ in }
    /// User-facing copy for a failed request.
    var describeError: (Error) -> String = { $0.localizedDescription }

    private let serverStateStore: ServerStateStore

    init(serverStateStore: ServerStateStore) {
        self.serverStateStore = serverStateStore
        serverURL = Keychain.get(Self.serverURLKey) ?? ""
        deviceID = Self.resolveDeviceID()
    }

    func refreshDeviceID() {
        deviceID = Self.resolveDeviceID()
    }

    private static func resolveDeviceID() -> String {
        if let existing = Keychain.get(deviceIDKey), !existing.isEmpty {
            return existing
        }
        let newValue = UUID().uuidString
        Keychain.set(newValue, for: deviceIDKey)
        return newValue
    }

    /// Resolves a possibly-relative image path against the server base URL.
    /// TMDB poster URLs are already absolute; library posters may be relative.
    func absoluteURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let absolute = URL(string: raw), absolute.scheme != nil {
            return absolute
        }
        guard let base = URL(string: serverURL) else { return nil }
        return URL(string: raw, relativeTo: base)?.absoluteURL
    }

    // MARK: API client and response cache

    private static func responseCacheRoot() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ResponseCache", isDirectory: true)
    }

    static func makeResponseCache(server: String) -> ResponseCache {
        ResponseCache(
            directory: responseCacheRoot()
                .appendingPathComponent(ResponseCache.namespace(forServer: server), isDirectory: true)
        )
    }

    /// Sign-out drops every server's saved responses: they belong to the account
    /// that fetched them.
    func wipeResponseCache() {
        try? FileManager.default.removeItem(at: Self.responseCacheRoot())
    }

    func makeAPIClient(baseURL: URL, token: String?) -> APIClient {
        serverStateStore.clear()
        PosterCache.authorize(server: baseURL, token: token)
        return APIClient(
            baseURL: baseURL,
            token: token,
            responseCache: Self.makeResponseCache(server: baseURL.absoluteString),
            onUnauthorized: {
                Task { @MainActor [weak self] in
                    self?.onSessionExpired()
                }
            }
        )
    }

    /// Makes `token` the live session for `server`.
    func activate(server: String, baseURL: URL, token: String) {
        serverURL = server
        apiClient = makeAPIClient(baseURL: baseURL, token: token)
        isLoggedIn = true
    }

    /// Writes the credential to the Keychain; a failure only warns, since the session works until relaunch.
    func persistCredentials(server: String, token: String) {
        let serverSaved = Keychain.set(server, for: Self.serverURLKey)
        let tokenSaved = Keychain.set(token, for: Self.authTokenKey)
        if !serverSaved || !tokenSaved {
            authWarning = Self.persistFailedWarning
        }
    }

    // MARK: Profile

    func applyUser(_ user: SessionUser) {
        isAdmin = user.isAdmin ?? false
        userId = user.id
        if let id = user.id {
            didIdentifyUser(id)
        }
        let full = [user.firstName, user.lastName].compactMap(\.self).joined(separator: " ")
        userFirstName = user.firstName ?? (full.isEmpty ? user.name : full)
        userInitials = UserInitials.from(firstName: user.firstName, lastName: user.lastName, name: user.name)
        userAvatarURL = absoluteURL(user.avatarUrl)
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
    /// offer "Add to library" (admin) vs "Request" (non-admin). Concurrent callers
    /// share one request; a failure keeps the profile painted from the cache.
    func refreshAdmin() async {
        if let profileTask {
            return await profileTask.value
        }
        guard let apiClient else { return }
        let task = Task { @MainActor [weak self] in
            if let user = await (try? apiClient.currentUser())?.user {
                self?.applyUser(user)
            }
        }
        profileTask = task
        await task.value
        if profileTask == task {
            profileTask = nil
        }
    }

    // MARK: Server features

    /// Paints the saved flag first so an offline launch hides Books too, then refreshes it from the server.
    func refreshBooksEnabled() async {
        guard let client = apiClient else { return }
        if let cached = client.cached(Endpoints.systemFeatures) {
            apply(cached.value)
        }
        if let features = try? await client.systemFeatures() {
            apply(features)
        }
    }

    private func apply(_ features: SystemFeatures) {
        booksEnabled = features.booksEnabled
        askBeforeAdding = features.askBeforeAdding ?? false
        requestersChooseSeasons = features.requestersChooseSeasons ?? false
    }

    // MARK: APNs token

    /// Called from the app delegate with the hex device token.
    func handleApnsToken(_ token: String) {
        pendingApnsToken = token
        Task { await registerApnsIfPossible() }
    }

    private func registerApnsIfPossible() async {
        guard let token = pendingApnsToken, let apiClient else { return }
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        try? await apiClient.registerApns(
            deviceToken: token,
            deviceName: UIDevice.current.name,
            osVersion: UIDevice.current.systemVersion,
            appVersion: appVersion,
            bundleId: Bundle.main.bundleIdentifier
        )
        registeredApnsToken = token
        pendingApnsToken = nil
    }

    // MARK: Sign-out pieces (AppModel.logout sequences them with the other domains)

    /// Before apiClient is torn down: an APNs token identifies the phone, not
    /// the account, so leaving it registered would deliver this user's
    /// notifications to whoever signs in next.
    func unregisterPushToken() {
        if let token = registeredApnsToken, let client = apiClient {
            Task { try? await client.unregisterApns(deviceToken: token) }
        }
        registeredApnsToken = nil
    }

    func resetServerFeatures() {
        booksEnabled = true
        askBeforeAdding = false
        requestersChooseSeasons = false
    }

    func deleteStoredCredentials() {
        Keychain.delete(Self.serverURLKey)
        Keychain.delete(Self.authTokenKey)
    }

    func cancelProfileFetch() {
        profileTask?.cancel()
        profileTask = nil
    }

    func dropAPIClient() {
        apiClient?.responseCache?.invalidate()
        wipeResponseCache()

        apiClient = nil
        PosterCache.authorize(server: nil, token: nil)
    }

    func clearIdentity() {
        isLoggedIn = false
        isAdmin = false
        userId = nil
        userFirstName = nil
        userInitials = nil
        userAvatarURL = nil
        errorMessage = nil
    }
}
