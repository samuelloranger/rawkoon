import RawkoonKit
import SwiftUI

/// The server pages and the System page: one summary row each on the phone's Settings screen,
/// and inset sections on the Mac's Server screen. A page with a single screen opens it directly.
enum SettingsGroup: String, CaseIterable, Identifiable {
    case connections
    case library
    case quality
    case afterDownload
    case books
    case people
    case general
    case ai
    case system

    /// The pages under Server, in order; System is a group of its own below them.
    static let server: [SettingsGroup] = allCases.filter { $0 != .system }

    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .connections: "Connections"
        case .library: "Library & import"
        case .quality: "Quality"
        case .afterDownload: "After download"
        case .books: "Books"
        case .people: "People"
        case .general: "General"
        case .ai: "AI"
        case .system: "System"
        }
    }

    var systemImage: String {
        switch self {
        case .connections: "point.3.connected.trianglepath.dotted"
        case .library: "folder"
        case .quality: "slider.horizontal.3"
        case .afterDownload: "arrow.up.arrow.down.circle"
        case .books: "books.vertical"
        case .people: "person.2"
        case .general: "globe"
        case .ai: "sparkles"
        case .system: "gearshape.2"
        }
    }

    var destinations: [SettingsDestination] {
        SettingsDestination.allCases.filter { $0.group == self }
    }

    /// The first few row titles, so the summary row says what sits behind it.
    var summary: String {
        let titles = destinations.map(\.localizedTitle)
        let shown = titles.prefix(3).joined(separator: ", ")
        return titles.count > 3 ? shown + "\u{2026}" : shown
    }
}

/// A single settings screen: its page, label, icon, search keywords, and the view it pushes.
enum SettingsDestination: String, CaseIterable, Identifiable {
    // You
    case security
    case alerts
    case appPreferences
    // Connections
    case tmdb
    case fanart
    case jellyfin
    case indexers
    case downloadClient
    // Library & import
    case mediaLibrary
    case libraryDefaults
    case autoGrab
    // Quality
    case qualityProfiles
    case customFormats
    // After download
    case seeding
    // Books
    case books
    case bookProviders
    case bookQualityProfiles
    // People
    case users
    case sessions
    case apiKeys
    case oidcProviders
    // General, AI
    case general
    case ai
    // System
    case health
    case jobs
    case reencode
    case clips
    case arrImport
    case blocklist
    case aiUsage
    case releases
    case liveUpdates

    var id: String {
        rawValue
    }

    /// The server page this screen sits under; nil for the personal screens.
    var group: SettingsGroup? {
        switch self {
        case .security, .alerts, .appPreferences: nil
        case .tmdb, .fanart, .jellyfin, .indexers, .downloadClient: .connections
        case .mediaLibrary, .libraryDefaults, .autoGrab: .library
        case .qualityProfiles, .customFormats: .quality
        case .seeding: .afterDownload
        case .books, .bookProviders, .bookQualityProfiles: .books
        case .users, .sessions, .apiKeys, .oidcProviders: .people
        case .general: .general
        case .ai: .ai
        case .health, .jobs, .reencode, .clips, .arrImport, .blocklist, .aiUsage, .releases, .liveUpdates: .system
        }
    }

    var isAdminOnly: Bool {
        group != nil
    }

    /// Row label. `LocalizedStringKey` so `Label` looks the key up in the
    /// catalog — a plain `String` hits the verbatim overload and shows English.
    var title: LocalizedStringKey {
        LocalizedStringKey(titleKey)
    }

    var titleKey: String {
        switch self {
        case .security: "Security"
        case .alerts: "Alerts"
        case .appPreferences: "App"
        case .tmdb: "TMDB"
        case .fanart: "fanart.tv"
        case .jellyfin: "Jellyfin"
        case .indexers: "Indexers"
        case .downloadClient: "Download client"
        case .mediaLibrary: "Folders & import"
        case .libraryDefaults: "Defaults"
        case .autoGrab: "Adding & checking"
        case .qualityProfiles: "Quality profiles"
        case .customFormats: "Custom formats"
        case .seeding: "Seeding"
        case .books: "Books"
        case .bookProviders: "Book providers"
        case .bookQualityProfiles: "Book quality profiles"
        case .users: "Users"
        case .sessions: "Sessions"
        case .apiKeys: "API keys"
        case .oidcProviders: "SSO providers"
        case .general: "General"
        case .ai: "AI"
        case .health: "Health"
        case .jobs: "Jobs"
        case .reencode: "Re-encode"
        case .clips: "Preview clips"
        case .arrImport: "Downloads"
        case .blocklist: "Blocklist"
        case .aiUsage: "AI usage"
        case .releases: "App updates"
        case .liveUpdates: "Live updates"
        }
    }

    var localizedTitle: String {
        String(localized: LocalizedStringResource(stringLiteral: titleKey))
    }

    var systemImage: String {
        switch self {
        case .security: "lock.shield"
        case .alerts: "bell"
        case .appPreferences: "iphone"
        case .tmdb: "film"
        case .fanart: "photo.on.rectangle"
        case .jellyfin: "play.rectangle"
        case .indexers: "magnifyingglass"
        case .downloadClient: "arrow.down.circle"
        case .mediaLibrary: "folder"
        case .libraryDefaults: "checklist"
        case .autoGrab: "bolt.badge.clock"
        case .qualityProfiles: "slider.horizontal.3"
        case .customFormats: "tag"
        case .seeding: "arrow.up.arrow.down.circle"
        case .books: "book"
        case .bookProviders: "books.vertical"
        case .bookQualityProfiles: "books.vertical.circle"
        case .users: "person.2"
        case .sessions: "shield"
        case .apiKeys: "key"
        case .oidcProviders: "person.badge.key"
        case .general: "globe"
        case .ai: "sparkles"
        case .health: "heart.text.square"
        case .jobs: "clock"
        case .reencode: "gauge.with.dots.needle.67percent"
        case .clips: "film.stack"
        case .arrImport: "square.and.arrow.down"
        case .blocklist: "nosign"
        case .aiUsage: "chart.bar"
        case .releases: "shippingbox"
        case .liveUpdates: "dot.radiowaves.left.and.right"
        }
    }

    /// Extra terms the search matches beyond the title, so common synonyms find a row.
    var keywords: [String] {
        switch self {
        case .security: ["password", "passkey", "calendar", "subscribe", "ics", "login"]
        case .alerts: ["notifications", "push", "devices", "channels", "ntfy", "webhook"]
        case .appPreferences: ["language", "playback", "rewind", "download", "wi-fi", "storage", "offline", "cache"]
        case .tmdb: ["the movie database", "metadata", "discovery"]
        case .fanart: ["fanart", "artwork", "posters", "backdrops", "metadata"]
        case .jellyfin: ["media server", "streaming"]
        case .indexers: [
                "indexer", "search", "trackers", "torrent", "usenet", "prowlarr", "jackett", "rss", "manager", "active",
            ]
        case .downloadClient: ["qbittorrent", "transmission", "deluge", "torrent", "download", "hook", "webhook"]
        case .mediaLibrary: [
                "folders", "paths", "root", "media", "library", "import", "post-processing", "template", "naming",
                "hardlink", "scan", "reindex",
            ]
        case .libraryDefaults: ["default", "profile", "movie", "show", "book", "quality"]
        case .autoGrab: [
                "grab", "auto", "automatic", "search", "search on add", "interval", "delay", "schedule", "cron",
                "check", "held", "pending", "rss",
            ]
        case .qualityProfiles: ["quality", "profile", "resolution", "cutoff", "hdr", "trackers", "grab delay"]
        case .customFormats: ["custom", "format", "scoring"]
        case .seeding: [
                "seeding", "seed", "ratio", "days", "time", "torrent", "release", "share", "sharing", "tracker",
                "private", "public", "extensions", "blocked", "free space", "safety", "override",
            ]
        case .books: ["audiobook", "ebook", "reading", "metadata sources", "files"]
        case .bookProviders: ["audnexus", "audible", "open library", "metadata", "books"]
        case .bookQualityProfiles: ["book", "quality", "profile"]
        case .users: ["accounts", "people", "members", "admin", "invitations", "invite"]
        case .sessions: ["login", "devices", "security"]
        case .apiKeys: ["api", "token", "keys", "access"]
        case .oidcProviders: ["sso", "oidc", "single sign-on", "login", "auth"]
        case .general: ["system", "app", "server", "country", "upcoming", "region"]
        case .ai: ["llm", "provider", "model", "prices", "budget", "api key"]
        case .health: ["readiness", "ready", "problems", "attention", "library health", "rss", "status", "fix"]
        case .jobs: ["tasks", "scheduled", "queue", "run"]
        case .reencode: ["re-encode", "transcode", "hevc", "av1", "queue", "compress", "run window"]
        case .clips: ["clips", "preview", "trailer", "backdrop", "tv", "thumbnail"]
        case .arrImport: ["radarr", "sonarr", "migrate", "import", "downloads"]
        case .blocklist: ["block", "banned", "releases"]
        case .aiUsage: ["ai", "llm", "usage", "cost", "spend", "history", "calls", "tokens", "stats"]
        case .releases: ["updates", "changelog", "version", "releases"]
        case .liveUpdates: ["sse", "stream", "events", "diagnostics", "debug", "reconnect"]
        }
    }

    /// True when the query (case-insensitive) is found in the title or a keyword.
    func matches(_ query: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty {
            return true
        }
        if localizedTitle.lowercased().contains(needle) {
            return true
        }
        return keywords.contains { $0.lowercased().contains(needle) }
    }

    /// Where a failing readiness check is fixed.
    static func fix(for check: GrabReadinessCheck) -> SettingsDestination? {
        switch check.fix {
        case .indexerManager: .indexers
        case .downloadClient: .downloadClient
        case .defaultProfiles: .libraryDefaults
        case .qualityProfiles: .qualityProfiles
        case nil: nil
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    @ViewBuilder
    var destination: some View {
        switch self {
        case .security: SettingsSecurityView()
        case .alerts: SettingsAlertsView()
        case .appPreferences: SettingsAppView()
        case .tmdb: TmdbIntegrationView()
        case .fanart: FanartIntegrationView()
        case .jellyfin: JellyfinIntegrationView()
        case .indexers: IndexersSettingsView()
        case .downloadClient: DownloadClientEditView()
        case .mediaLibrary: MediaLibrarySettingsView()
        case .libraryDefaults: LibraryDefaultsView()
        case .autoGrab: AutoGrabSettingsView()
        case .qualityProfiles: QualityProfilesCrudView()
        case .customFormats: CustomFormatsCrudView()
        case .seeding: SeedingSettingsView()
        case .books: BooksSettingsView()
        case .bookProviders: BooksProviderView()
        case .bookQualityProfiles: BookQualityProfilesCrudView()
        case .users: UsersAdminView()
        case .sessions: SessionsAdminView()
        case .apiKeys: ApiKeysAdminView()
        case .oidcProviders: OidcProvidersCrudView()
        case .general: GeneralSettingsView()
        case .ai: AiSettingsView()
        case .health: HealthSettingsView()
        case .jobs: JobsAdminView()
        case .reencode: ReencodeAdminView()
        case .clips: ClipsAdminView()
        case .arrImport: ArrLibraryImportView()
        case .blocklist: BlocklistAdminView()
        case .aiUsage: AiUsageView()
        case .releases: ReleasesAdminView()
        case .liveUpdates: SSEDebugView()
        }
    }
}

/// A page's screens, pushed from its summary row; a page with one screen skips this list.
struct SettingsGroupView: View {
    let group: SettingsGroup
    /// Open-problem counts to show beside a screen's row.
    var badges: [SettingsDestination: Int] = [:]

    var body: some View {
        Form {
            Section {
                ForEach(group.destinations) { destination in
                    NavigationLink {
                        destination.destination
                    } label: {
                        SettingsDestinationRow(destination: destination, badge: badges[destination] ?? 0)
                    }
                }
            }
            .listRowBackground(Theme.raised)
        }
        .settingsScreenStyle()
        .navigationTitle(group.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
