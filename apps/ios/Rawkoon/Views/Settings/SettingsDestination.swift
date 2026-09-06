import SwiftUI

/// The five admin taxonomy groups the settings screen renders as inset sections.
enum SettingsGroup: String, CaseIterable, Identifiable {
    case system
    case integrations
    case libraryQuality
    case usersSecurity
    case jobsReleases

    var id: String {
        rawValue
    }

    /// Sanctioned new section-header wording for the regroup.
    var title: LocalizedStringKey {
        switch self {
        case .system: "System"
        case .integrations: "Integrations"
        case .libraryQuality: "Library & Quality"
        case .usersSecurity: "Users & Security"
        case .jobsReleases: "Jobs & Releases"
        }
    }
}

/// A single admin settings row: its taxonomy group, label, icon, search keywords,
/// and the existing view it pushes. Replaces the 22 inline `NavigationLink`s.
enum SettingsDestination: String, CaseIterable, Identifiable {
    case general
    case tmdb
    case jellyfin
    case localAi
    case prowlarr
    case jackett
    case indexers
    case downloadClient
    case bookProviders
    case mediaLibrary
    case arrImport
    case qualityProfiles
    case customFormats
    case books
    case bookQualityProfiles
    case users
    case sessions
    case apiKeys
    case oidcProviders
    case blocklist
    case jobs
    case releases

    var id: String {
        rawValue
    }

    var group: SettingsGroup {
        switch self {
        case .general:
            .system
        case .tmdb, .jellyfin, .localAi, .prowlarr, .jackett, .indexers, .downloadClient, .bookProviders:
            .integrations
        case .mediaLibrary, .arrImport, .qualityProfiles, .customFormats, .books, .bookQualityProfiles:
            .libraryQuality
        case .users, .sessions, .apiKeys, .oidcProviders, .blocklist:
            .usersSecurity
        case .jobs, .releases:
            .jobsReleases
        }
    }

    /// Row label — kept as a plain `String` so the same value drives both the
    /// visible label and the in-Swift search filter. Wording is unchanged from
    /// the flat list it replaces.
    var title: String {
        switch self {
        case .general: "General"
        case .tmdb: "TMDB"
        case .jellyfin: "Jellyfin"
        case .localAi: "Local AI"
        case .prowlarr: "Prowlarr"
        case .jackett: "Jackett"
        case .indexers: "Indexers"
        case .downloadClient: "Download client"
        case .bookProviders: "Book providers"
        case .mediaLibrary: "Library"
        case .arrImport: "Import from Radarr/Sonarr"
        case .qualityProfiles: "Quality profiles"
        case .customFormats: "Custom formats"
        case .books: "Books"
        case .bookQualityProfiles: "Book quality profiles"
        case .users: "Users"
        case .sessions: "Sessions"
        case .apiKeys: "API keys"
        case .oidcProviders: "SSO providers"
        case .blocklist: "Blocklist"
        case .jobs: "Jobs"
        case .releases: "Releases"
        }
    }

    var systemImage: String {
        switch self {
        case .general: "globe"
        case .tmdb: "film"
        case .jellyfin: "play.rectangle"
        case .localAi: "brain"
        case .prowlarr: "magnifyingglass.circle"
        case .jackett: "magnifyingglass.circle"
        case .indexers: "magnifyingglass"
        case .downloadClient: "arrow.down.circle"
        case .bookProviders: "books.vertical"
        case .mediaLibrary: "folder"
        case .arrImport: "square.and.arrow.down"
        case .qualityProfiles: "slider.horizontal.3"
        case .customFormats: "tag"
        case .books: "book"
        case .bookQualityProfiles: "books.vertical.circle"
        case .users: "person.2"
        case .sessions: "shield"
        case .apiKeys: "key"
        case .oidcProviders: "person.badge.key"
        case .blocklist: "nosign"
        case .jobs: "clock"
        case .releases: "shippingbox"
        }
    }

    /// Extra terms the search matches beyond the title, so common synonyms find a row.
    var keywords: [String] {
        switch self {
        case .general: ["system", "app", "server"]
        case .tmdb: ["the movie database", "metadata", "discovery"]
        case .jellyfin: ["media server", "streaming"]
        case .localAi: ["ai", "llm", "recommendations"]
        case .prowlarr: ["indexer", "search", "releases"]
        case .jackett: ["indexer", "search", "releases"]
        case .indexers: ["indexer", "search", "trackers", "torrent", "usenet"]
        case .downloadClient: ["qbittorrent", "transmission", "deluge", "torrent", "download"]
        case .bookProviders: ["audnexus", "audible", "open library", "metadata", "books"]
        case .mediaLibrary: ["folders", "paths", "root", "media", "library"]
        case .arrImport: ["radarr", "sonarr", "migrate", "import"]
        case .qualityProfiles: ["quality", "profile", "resolution"]
        case .customFormats: ["custom", "format", "scoring"]
        case .books: ["audiobook", "ebook", "reading"]
        case .bookQualityProfiles: ["book", "quality", "profile"]
        case .users: ["accounts", "people", "members", "admin"]
        case .sessions: ["login", "devices", "security"]
        case .apiKeys: ["api", "token", "keys", "access"]
        case .oidcProviders: ["sso", "oidc", "single sign-on", "login", "auth"]
        case .blocklist: ["block", "banned", "releases"]
        case .jobs: ["tasks", "scheduled", "queue"]
        case .releases: ["updates", "changelog", "version"]
        }
    }

    /// True when the query (case-insensitive) is found in the title or a keyword.
    func matches(_ query: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty {
            return true
        }
        if title.lowercased().contains(needle) {
            return true
        }
        return keywords.contains { $0.lowercased().contains(needle) }
    }

    @ViewBuilder
    var destination: some View {
        switch self {
        case .general: GeneralSettingsView()
        case .tmdb: TmdbIntegrationView()
        case .jellyfin: JellyfinIntegrationView()
        case .localAi: LocalAiIntegrationView()
        case .prowlarr: IndexerManagerIntegrationView(kind: .prowlarr)
        case .jackett: IndexerManagerIntegrationView(kind: .jackett)
        case .indexers: IndexersView()
        case .downloadClient: DownloadClientEditView()
        case .bookProviders: BooksProviderView()
        case .mediaLibrary: MediaLibrarySettingsView()
        case .arrImport: ArrLibraryImportView()
        case .qualityProfiles: QualityProfilesCrudView()
        case .customFormats: CustomFormatsCrudView()
        case .books: BooksSettingsView()
        case .bookQualityProfiles: BookQualityProfilesCrudView()
        case .users: UsersAdminView()
        case .sessions: SessionsAdminView()
        case .apiKeys: ApiKeysAdminView()
        case .oidcProviders: OidcProvidersCrudView()
        case .blocklist: BlocklistAdminView()
        case .jobs: JobsAdminView()
        case .releases: ReleasesAdminView()
        }
    }
}
