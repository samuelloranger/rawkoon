import Combine
import Foundation
import Network
import RawkoonKit
import UIKit
import UserNotifications

/// Runs `operation`, giving up and returning nil after `seconds`.
///
/// The losing child is cancelled, but a URLSession call already in flight keeps
/// running to its own timeout in the background; the point is only that the
/// caller stops waiting on it.
private func withDeadline<T: Sendable>(
    seconds: Double,
    _ operation: @escaping @Sendable () async -> T?
) async -> T? {
    await withTaskGroup(of: T?.self) { group in
        group.addTask { await operation() }
        group.addTask {
            try? await Task.sleep(for: .seconds(seconds))
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

@MainActor
final class AppModel: ObservableObject {
    /// One instance for the process.
    ///
    /// A background launch to deliver `handleEventsForBackgroundURLSession` may
    /// never render a view, so the AppDelegate cannot wait for `onAppear` to be
    /// handed the model — by then the completion handler is long overdue and the
    /// finished downloads are discarded.
    static let shared = AppModel()

    @Published var isLoggedIn = false
    @Published var serverURL: String
    @Published var library: [BookListItem] = []
    @Published var isAdmin = false
    @Published var userFirstName: String?
    @Published var ssoProviders: [SsoProvider] = []
    @Published var loading = false
    @Published var errorMessage: String?
    @Published var downloadPlans: [Int: DownloadPlan] = [:]
    @Published var activeEditionId: Int?

    let player = AudiobookPlayer()

    private static let serverURLKey = "server_url"
    private static let authTokenKey = "auth_token"
    private static let deviceIDKey = "device_id"

    private var apiClient: APIClient?
    private var manifests: [Int: BookManifest] = [:]
    private var downloaders: [Int: ChapterDownloader] = [:]
    private var pendingBackgroundCompletions: [String: () -> Void] = [:]
    private var cancellables = Set<AnyCancellable>()
    private var verifiedCounts: [Int: Int] = [:]
    private var lastProgressWriteMillis: [Int: Int64] = [:]
    /// Whether the device currently has a usable network path.
    ///
    /// Starts `true` so a launch never assumes offline before the monitor has
    /// reported. It says an interface exists, not that the server answers — a
    /// captive portal or a down server still has to be handled by whatever
    /// waits on the request.
    @Published private(set) var isOnline = true
    private let pathMonitor = NWPathMonitor()

    private let readingProgressStore = ReadingProgressStore(
        directory: FileStore.booksDirectory()
    )
    private var lastProgressPosition: [Int: Double] = [:]

    private let journalURL: URL
    private let deviceID: String

    init() {
        serverURL = Keychain.get(Self.serverURLKey) ?? ""
        journalURL = Self.positionLogURL()
        deviceID = Self.resolveDeviceID()

        if
            let token = Keychain.get(Self.authTokenKey),
            let baseURL = URL(string: serverURL)
        {
            apiClient = APIClient(baseURL: baseURL, token: token)
            isLoggedIn = true
        }

        bindPlayer()
        startPathMonitor()
    }

    private func startPathMonitor() {
        pathMonitor.pathUpdateHandler = { path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                self?.isOnline = online
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "cloud.samlo.rawkoon.path"))
    }

    func login(server: String, email: String, password: String) async {
        let normalizedServer = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let baseURL = URL(string: normalizedServer) else {
            errorMessage = "Enter a valid server URL."
            return
        }

        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            let client = APIClient(baseURL: baseURL, token: nil)
            let token = try await client.login(email: email, password: password)

            Keychain.set(normalizedServer, for: Self.serverURLKey)
            Keychain.set(token, for: Self.authTokenKey)

            serverURL = normalizedServer
            apiClient = client
            isLoggedIn = true
            try await reloadLibrary()
            requestPushAuthorization()
        } catch {
            errorMessage = message(for: error)
        }
    }

    #if DEBUG
    /// Simulator/screenshot convenience: log in from launch environment when
    /// present. Compiled only in Debug, so it never ships in a Release/TestFlight
    /// build. Pass via `SIMCTL_CHILD_RAWKOON_SERVER` etc. to `simctl launch`.
    func debugAutologinIfNeeded() async {
        guard !isLoggedIn else { return }
        let env = ProcessInfo.processInfo.environment

        // A simulator build carries no keychain entitlement, so nothing the app
        // stores survives a relaunch and every launch starts logged out. Taking
        // a bearer token straight from the environment sidesteps the keychain
        // entirely, and avoids putting a real password on a command line.
        if
            let server = env["RAWKOON_SERVER"],
            let token = env["RAWKOON_TOKEN"],
            let baseURL = URL(string: server)
        {
            serverURL = server
            apiClient = APIClient(baseURL: baseURL, token: token)
            isLoggedIn = true
            try? await reloadLibrary()
            return
        }

        guard
            let server = env["RAWKOON_SERVER"],
            let email = env["RAWKOON_EMAIL"],
            let password = env["RAWKOON_PASSWORD"]
        else { return }
        await login(server: server, email: email, password: password)
    }
    #endif

    /// Load the enabled OAuth providers for the login screen (public endpoint).
    func loadSsoProviders() async {
        let raw = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, let base = URL(string: raw) else { ssoProviders = []; return }
        let client = apiClient ?? APIClient(baseURL: base, token: nil)
        ssoProviders = (try? await client.ssoProviders().providers) ?? []
    }

    /// Sign in through a provider using the native browser OAuth flow.
    func signInWithProvider(_ slug: String) async {
        let raw = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let base = URL(string: raw),
            let startURL = URL(string: "/api/mobile/oauth-start?provider=\(slug)", relativeTo: base)?.absoluteURL
        else {
            errorMessage = "Enter a valid server URL."
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
            errorMessage = "Sign-in failed. Please try again."
        }
    }

    private func applyOAuthToken(server: String, token: String) async {
        guard let base = URL(string: server) else {
            errorMessage = "Enter a valid server URL."
            return
        }
        Keychain.set(server, for: Self.serverURLKey)
        Keychain.set(token, for: Self.authTokenKey)
        serverURL = server
        apiClient = APIClient(baseURL: base, token: token)
        isLoggedIn = true
        do { try await reloadLibrary() } catch { errorMessage = message(for: error) }
        requestPushAuthorization()
    }

    func loadLibrary() async {
        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            try await reloadLibrary()
        } catch {
            errorMessage = message(for: error)
        }
    }

    /// The configured API client, or nil when logged out. Manage-lane screens
    /// call this directly (e.g. `try await model.api()?.explore()`).
    func api() -> APIClient? { apiClient }

    // MARK: Push notifications (APNs)

    private var pendingApnsToken: String?
    /// Retained after registration so sign-out can unregister it.
    private var registeredApnsToken: String?
    /// Editions whose grants are being refetched, and how often — a server whose
    /// secret rotated would otherwise refetch forever.
    private var grantRefreshAttempts: [Int: Int] = [:]
    private var grantRefreshInFlight: Set<Int> = []

    /// Ask for notification permission, then register for remote notifications.
    /// Safe to call repeatedly — the system won't re-prompt once decided.
    func requestPushAuthorization() {
        Task {
            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

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

    /// The book currently loaded in the player, if any — drives the persistent
    /// mini-player and its expand-to-full-player sheet. Non-nil once
    /// `openPlayer(editionId:)` has run (it caches the manifest and sets
    /// `activeEditionId`).
    func activeBook() -> (summary: LibrarySummary, manifest: BookManifest)? {
        guard
            let id = activeEditionId,
            let summary = library.first(where: { $0.audiobookEditionId == id })?.audiobookSummary,
            let manifest = manifests[id]
        else {
            return nil
        }
        return (summary, manifest)
    }

    /// Resolves a possibly-relative image path against the server base URL.
    /// TMDB poster URLs are already absolute; library posters may be relative.
    func absoluteURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let absolute = URL(string: raw), absolute.scheme != nil { return absolute }
        guard let base = URL(string: serverURL) else { return nil }
        return URL(string: raw, relativeTo: base)?.absoluteURL
    }

    func manifest(_ editionId: Int, forceRefresh: Bool = false) async throws -> BookManifest {
        if !forceRefresh, let cached = manifests[editionId] {
            return cached
        }
        guard let apiClient else {
            throw APIError.unauthorized
        }

        let fetched = try await apiClient.manifest(editionId: editionId)
        manifests[editionId] = fetched
        return fetched
    }

    func startDownload(editionId: Int) async {
        errorMessage = nil

        do {
            let manifest = try await manifest(editionId)
            guard let baseURL = URL(string: serverURL) else {
                errorMessage = "Enter a valid server URL."
                return
            }
            if let existing = downloaders[editionId] {
                existing.start()
                return
            }

            let allowCellularDownloads = UserDefaults.standard.string(forKey: "download_over") != "wifi"
            let downloader = ChapterDownloader(
                editionId: editionId,
                baseURL: baseURL,
                manifest: manifest,
                allowCellular: allowCellularDownloads
            ) { [weak self] plan in
                Task { @MainActor in
                    self?.applyDownloadPlan(plan, editionId: editionId)
                }
            }
            if let pending = pendingBackgroundCompletions.first(where: { downloader.hasBackgroundSession(identifier: $0.key) }) {
                downloader.setBackgroundSessionCompletion(pending.value)
                pendingBackgroundCompletions.removeValue(forKey: pending.key)
            }

            downloaders[editionId] = downloader
            downloader.start()
        } catch {
            errorMessage = message(for: error)
        }
    }

    func openPlayer(editionId: Int, resumeAt overridePosition: Double? = nil) async {
        errorMessage = nil

        do {
            let manifest = try await manifest(editionId)
            guard let baseURL = URL(string: serverURL) else {
                errorMessage = "Enter a valid server URL."
                return
            }
            activeEditionId = editionId

            let resumeAt: Double
            if let overridePosition {
                resumeAt = max(0, min(overridePosition, manifest.totalDurationSecs))
            } else {
                resumeAt = await resolveResumePosition(editionId: editionId, manifest: manifest)
            }
            player.load(
                manifest: manifest,
                baseURL: baseURL,
                resumeAt: resumeAt,
                artworkURL: library
                    .first(where: { $0.audiobookEditionId == editionId })?
                    .audiobookSummary?.coverURL
            )
        } catch {
            errorMessage = message(for: error)
        }
    }

    /// Closes the player: stops audio, drops Now Playing, hides the mini bar.
    func closePlayer() {
        player.unload()
        activeEditionId = nil
    }

    func handleBackgroundEvents(identifier: String, completionHandler: @escaping () -> Void) {
        if let downloader = downloaders.values.first(where: { $0.hasBackgroundSession(identifier: identifier) }) {
            downloader.setBackgroundSessionCompletion(completionHandler)
            downloader.start()
            return
        }

        pendingBackgroundCompletions[identifier] = completionHandler

        // The `downloaders` map is in-memory, so after the app was terminated it
        // is empty and nothing is attached to the session. iOS delivers
        // `didFinishDownloadingTo` only to a delegate, and discards the
        // temporary file if none exists — so the downloader has to be rebuilt
        // here rather than waiting for the user to tap download again.
        // `startDownload` picks the pending completion up by identifier.
        guard let editionId = ChapterDownloader.editionId(fromSessionIdentifier: identifier) else {
            pendingBackgroundCompletions.removeValue(forKey: identifier)
            completionHandler()
            return
        }
        Task { await startDownload(editionId: editionId) }
    }

    func logout() {
        // Before apiClient is torn down: an APNs token identifies the phone, not
        // the account, so leaving it registered would deliver this user's
        // notifications to whoever signs in next.
        if let token = registeredApnsToken, let client = apiClient {
            Task { try? await client.unregisterApns(deviceToken: token) }
        }
        registeredApnsToken = nil

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
        activeEditionId = nil
        player.pause()
        errorMessage = nil
    }

    func deleteDownloads() {
        let editionIDs = Set(library.compactMap(\.audiobookEditionId))
            .union(manifests.keys)
            .union(downloadPlans.keys)

        for editionId in editionIDs {
            FileStore.deleteEdition(editionId)
        }

        downloadPlans = [:]
        verifiedCounts = [:]
        if activeEditionId != nil {
            player.rebuild()
        }
    }

    private func bindPlayer() {
        player.objectWillChange
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        player.$positionSecs
            .sink { [weak self] _ in
                self?.persistPlaybackProgress(force: false)
            }
            .store(in: &cancellables)

        player.$isPlaying
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] isPlaying in
                guard !isPlaying else { return }
                self?.persistPlaybackProgress(force: true)
            }
            .store(in: &cancellables)
    }

    /// Replaces the downloader's signed URLs after a grant expired.
    ///
    /// The plan requeues a 401/403 chapter without spending an attempt, so
    /// without this the same dead URL is pumped forever. Capped, because a
    /// rotated server secret makes every refetch land on the same wall.
    private func refreshGrants(editionId: Int) async {
        guard !grantRefreshInFlight.contains(editionId) else { return }
        let attempts = grantRefreshAttempts[editionId] ?? 0
        guard attempts < Self.maxGrantRefreshAttempts else {
            errorMessage = "Downloads for this book need a fresh sign-in."
            return
        }
        grantRefreshInFlight.insert(editionId)
        grantRefreshAttempts[editionId] = attempts + 1
        defer { grantRefreshInFlight.remove(editionId) }

        guard let refreshed = try? await manifest(editionId, forceRefresh: true) else { return }
        downloaders[editionId]?.refreshChapterURLs(from: refreshed)
    }

    private static let maxGrantRefreshAttempts = 3

    private func applyDownloadPlan(_ plan: DownloadPlan, editionId: Int) {
        if plan.needsFreshGrants {
            Task { await refreshGrants(editionId: editionId) }
        }

        let newCount = verifiedChapterCount(in: plan)

        downloadPlans[editionId] = plan
        verifiedCounts[editionId] = newCount
    }

    private func resolveResumePosition(editionId: Int, manifest: BookManifest) async -> Double {
        let localEntry = PositionJournal.latest(in: readJournal(), editionId: editionId)
        let localRecord = localEntry.map {
            ProgressRecord(
                positionSecs: $0.positionSecs,
                totalDurationSecs: manifest.totalDurationSecs,
                finished: $0.positionSecs >= manifest.totalDurationSecs,
                updatedAtMillis: $0.atMillis
            )
        }

        var remoteRecord: ProgressRecord?
        if let apiClient,
           let remote = (try? await apiClient.getProgress())?.first(where: { $0.editionId == editionId }) {
            remoteRecord = ProgressRecord(
                positionSecs: remote.positionSecs,
                totalDurationSecs: remote.totalDurationSecs,
                finished: remote.finished,
                updatedAtMillis: Int64(remote.updatedAt.timeIntervalSince1970 * 1000)
            )
        }

        switch SyncReconciler.reconcile(local: localRecord, remote: remoteRecord) {
        case .keepLocal:
            return localRecord?.positionSecs ?? 0
        case .takeRemote:
            guard let remoteRecord else { return localRecord?.positionSecs ?? 0 }
            let adjusted = SyncReconciler.adjust(remoteRecord, toTotal: manifest.totalDurationSecs)
            let entry = PositionEntry(
                editionId: editionId,
                positionSecs: adjusted.positionSecs,
                atMillis: adjusted.updatedAtMillis
            )
            appendJournal(entry)
            return adjusted.positionSecs
        case .push:
            guard let localRecord else { return 0 }
            sendProgress(
                editionId: editionId,
                positionSecs: localRecord.positionSecs,
                totalDurationSecs: manifest.totalDurationSecs,
                updatedAtMillis: localRecord.updatedAtMillis
            )
            return localRecord.positionSecs
        }
    }

    private func persistPlaybackProgress(force: Bool) {
        guard let editionId = activeEditionId, let manifest = manifests[editionId] else {
            return
        }

        let nowMillis = Self.nowMillis()
        if !force {
            let elapsed = nowMillis - (lastProgressWriteMillis[editionId] ?? 0)
            if elapsed < 5_000 {
                return
            }
            if let last = lastProgressPosition[editionId], abs(last - player.positionSecs) < 1 {
                return
            }
        }

        let timeline = BookTimeline(chapters: manifest.chapters)
        let clamped = timeline.clamp(player.positionSecs)
        let entry = PositionEntry(editionId: editionId, positionSecs: clamped, atMillis: nowMillis)
        appendJournal(entry)

        lastProgressWriteMillis[editionId] = nowMillis
        lastProgressPosition[editionId] = clamped

        sendProgress(
            editionId: editionId,
            positionSecs: clamped,
            totalDurationSecs: manifest.totalDurationSecs,
            updatedAtMillis: nowMillis
        )
    }

    // MARK: Reading progress (ebooks)

    /// Where to open an ebook edition, reconciled across this device and the
    /// server. Same last-write-wins rule as the audiobook position. The caller
    /// prefers `winner.locator` when it parses; otherwise it runs
    /// `ReadingProgressReconciler.resolve` against the publication spine.
    func readingPosition(editionId: Int) async -> ReadingPosition? {
        let local = readingProgressStore.position(editionId: editionId)
        var remote: ReadingPosition?
        // Two separate reasons this must not block the reader.
        //
        // With no network path at all the request cannot succeed, so it is not
        // even attempted. But a path monitor reports "satisfied" whenever an
        // interface exists, and for a self-hosted server the common case is
        // having internet while the server itself is unreachable — away from
        // home, a captive portal, the box rebooting. There the request runs into
        // URLSession's full 60-second timeout, and the reader sat on
        // "Opening book…" that whole time for a book already on disk. So it is
        // also given a short deadline, after which the local position wins.
        if isOnline, let apiClient {
            remote = await withDeadline(seconds: 5) {
                (try? await apiClient.readingProgress())?
                    .first { $0.editionId == editionId }
            }
        }

        let winner: ReadingPosition?
        switch ReadingProgressReconciler.reconcile(local: local, remote: remote) {
        case .takeRemote:
            winner = remote
            // Mirror it locally so the next open resumes offline too.
            if let remote { try? readingProgressStore.save(remote) }
        case .keepLocal, .push:
            winner = local
        }
        return winner
    }

    /// Persists locally first, then pushes. The local write is what makes the
    /// position survive a crash or an offline session; the push is best-effort.
    func saveReadingPosition(_ position: ReadingPosition) {
        try? readingProgressStore.save(position)
        guard let apiClient else { return }
        Task { try? await apiClient.putReadingProgress(position, deviceId: deviceID) }
    }

    private func sendProgress(
        editionId: Int,
        positionSecs: Double,
        totalDurationSecs: Double,
        updatedAtMillis: Int64
    ) {
        guard let apiClient else { return }
        let finished = positionSecs >= max(totalDurationSecs - 1, 0)
        let updatedAt = Date(timeIntervalSince1970: Double(updatedAtMillis) / 1000)

        Task {
            try? await apiClient.putProgress(
                editionId: editionId,
                positionSecs: positionSecs,
                totalDurationSecs: totalDurationSecs,
                finished: finished,
                updatedAt: updatedAt,
                deviceId: deviceID
            )
        }
    }

    private func reloadLibrary() async throws {
        guard let apiClient else { throw APIError.unauthorized }
        let fetched = try await apiClient.libraryBooks()
        library = fetched.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        await refreshAdmin()
    }

    /// Best-effort: learn whether the signed-in user is an admin, so the UI can
    /// offer "Add to library" (admin) vs "Request" (non-admin).
    private func refreshAdmin() async {
        guard let apiClient else { return }
        if let user = (try? await apiClient.currentUser())?.user {
            isAdmin = user.isAdmin ?? false
            let full = [user.firstName, user.lastName].compactMap { $0 }.joined(separator: " ")
            userFirstName = user.firstName ?? (full.isEmpty ? user.name : full)
        }
    }

    private func readJournal() -> String {
        (try? String(contentsOf: journalURL, encoding: .utf8)) ?? ""
    }

    private func appendJournal(_ entry: PositionEntry) {
        let line = PositionJournal.encode(entry)
        guard !line.isEmpty, let data = line.data(using: .utf8) else {
            return
        }

        if !FileManager.default.fileExists(atPath: journalURL.path) {
            FileManager.default.createFile(atPath: journalURL.path, contents: nil)
        }

        guard let handle = try? FileHandle(forWritingTo: journalURL) else {
            return
        }

        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.close()
        } catch {
            try? handle.close()
        }
    }

    private func verifiedChapterCount(in plan: DownloadPlan) -> Int {
        plan.chapters.reduce(into: 0) { count, chapter in
            if plan.states[chapter.fileId] == .verified {
                count += 1
            }
        }
    }

    private func message(for error: Error) -> String {
        guard let apiError = error as? APIError else {
            return "Unexpected error. Please try again."
        }
        switch apiError {
        case .unauthorized:
            return "Unauthorized. Check your credentials."
        case let .http(status):
            return "Server error (\(status))."
        case .decode:
            return "Could not parse server response."
        case .transport:
            return "Network error. Check your connection."
        }
    }

    private static func resolveDeviceID() -> String {
        if let existing = Keychain.get(deviceIDKey), !existing.isEmpty {
            return existing
        }
        let newValue = UUID().uuidString
        Keychain.set(newValue, for: deviceIDKey)
        return newValue
    }

    private static func positionLogURL() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var url = root.appendingPathComponent("positions.log", isDirectory: false)
        FileStore.excludeFromBackup(&url)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        return url
    }

    private static func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
