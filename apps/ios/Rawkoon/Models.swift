import Foundation

// MARK: - Discover / TMDB

//
// JSON is snake_case; the media decoder uses `.convertFromSnakeCase`, so Swift
// camelCase properties map automatically. Dates stay as ISO strings and are
// formatted in the view layer. Codable ignores JSON keys not listed here, so
// each struct declares only the fields the app actually uses.

nonisolated struct TmdbSearchItem: Decodable, Identifiable, Hashable, Sendable {
    let id: String // "${media_type}-${tmdb_id}"
    let tmdbId: Int
    let mediaType: String // "movie" | "tv"
    let title: String
    let releaseYear: Int?
    let posterUrl: String?
    let overview: String?
    let voteAverage: Double?
    let alreadyExists: Bool?
    let canAdd: Bool?
    let libraryId: Int?
}

nonisolated struct TmdbSearchResponse: Decodable, Sendable {
    let enabled: Bool?
    let items: [TmdbSearchItem]
}

// MARK: - Discover deck (swipe)

nonisolated enum DiscoverSource: String, Codable, Sendable {
    case personalized
    case trending
}

nonisolated struct DiscoverDeckItem: Codable, Identifiable, Hashable, Sendable {
    let id: String // "${media_type}-${tmdb_id}"
    let tmdbId: Int
    let mediaType: String // "movie" | "tv"
    let title: String
    let releaseYear: Int?
    let posterUrl: String?
    let overview: String?
    let voteAverage: Double?
    let genreIds: [Int]
}

nonisolated struct DiscoverDeckResponse: Codable, Sendable {
    let items: [DiscoverDeckItem]
    let source: DiscoverSource
}

// MARK: - Library stats (Home ops widget)

/// Only the fields the Home "Library" widget renders; the endpoint also returns
/// per-status/type and per-tmdb-status breakdowns, ignored here.
nonisolated struct LibraryStats: Decodable, Sendable {
    let totalMovies: Int
    let totalShows: Int
    let downloaded: Int
    let wanted: Int
    let returningSeries: Int
    let storageUsedBytes: Int
    let storageByResolution: [StorageByResolution]
}

nonisolated struct StorageByResolution: Decodable, Identifiable, Sendable {
    let resolution: String
    let sizeBytes: Int
    var id: String {
        resolution
    }
}

// MARK: - Discover filter grid (Explore)

/// Copies server `DISCOVER_VALID_SORTS` (tmdbRouteHelpers.ts) exactly so the UI
/// can't send an invalid `sort_by` value.
nonisolated enum DiscoverSort: String, CaseIterable, Sendable {
    case popularityDesc = "popularity.desc"
    case popularityAsc = "popularity.asc"
    case voteAverageDesc = "vote_average.desc"
    case voteAverageAsc = "vote_average.asc"
    case primaryReleaseDateDesc = "primary_release_date.desc"
    case firstAirDateDesc = "first_air_date.desc"
    case revenueDesc = "revenue.desc"
}

nonisolated struct DiscoverMediasResponse: Decodable, Sendable {
    let items: [TmdbSearchItem]
    let page: Int
    let region: String?
    let totalPages: Int
    let totalResults: Int
}

nonisolated struct Genre: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
}

nonisolated struct GenresResponse: Decodable, Sendable {
    let genres: [Genre]
}

nonisolated struct StreamingProvider: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let logoUrl: String? // server key is `logo_url`, not `logo_path`
}

nonisolated struct StreamingProvidersResponse: Decodable, Sendable {
    let providers: [StreamingProvider]
    let region: String?
}

nonisolated struct BookSearchHit: Decodable, Identifiable, Hashable, Sendable {
    var id: String {
        googleVolumeId
    }

    let googleVolumeId: String
    let title: String
    let subtitle: String?
    let authors: [String]
    let publishedYear: Int?
    let coverUrl: String?
    let overview: String?
    let inLibrary: Bool
    let libraryBookId: Int?
}

nonisolated struct BookSearchResponse: Decodable, Sendable {
    let results: [BookSearchHit]
}

// MARK: - Media detail (TMDB modal)

nonisolated struct MediaModalResponse: Decodable, Sendable {
    let watchlistStatus: Bool?
    let watchlistId: Int?
    let details: TmdbMediaDetails
    let credits: MediaCredits?
    let trailer: MediaTrailer?
    let providers: WatchProviders?
    let ratings: MediaRatings?
}

nonisolated struct CastMember: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let character: String?
    let profileUrl: String?
}

nonisolated struct MediaCredits: Decodable, Sendable {
    let cast: [CastMember]
    let directors: [String]?
}

nonisolated struct MediaTrailer: Decodable, Sendable {
    let key: String?
    let name: String?
}

/// Mirrors `TmdbWatchProvidersResponse` (media.ts) exactly — `streaming`, not `stream`.
nonisolated struct WatchProviders: Decodable, Sendable {
    let region: String?
    let streaming: [StreamingProvider]?
    let free: [StreamingProvider]?
    let rent: [StreamingProvider]?
    let buy: [StreamingProvider]?
    let link: String?
}

nonisolated struct MediaRatings: Decodable, Sendable {
    let imdbRating: String?
    let rottenTomatoes: String?
    let metacritic: String?
}

nonisolated struct TmdbMediaDetails: Decodable, Sendable {
    let runtime: Int?
    let overview: String?
    let voteAverage: Double?
    let numberOfSeasons: Int?
    let numberOfEpisodes: Int?
    let releaseDate: String?
    let firstAirDate: String?
    let tagline: String?
    let status: String?
    let genres: [NamedRef]?
    let primaryBackdropUrl: String?
    let seasons: [SeasonSummary]?
    // TMDB localized titles for the release-search language picker (Phase 5).
    let originalTitle: String?
    let originalLanguage: String?
    let titleTranslations: [TitleTranslation]?
}

/// One TMDB per-language title (`title_translations` on the modal details).
nonisolated struct TitleTranslation: Decodable, Sendable {
    let languageCode: String
    let title: String
}

nonisolated struct NamedRef: Decodable, Hashable, Sendable {
    let id: Int
    let name: String
}

nonisolated struct SeasonSummary: Decodable, Hashable, Sendable {
    let seasonNumber: Int
    let name: String
    let episodeCount: Int?
}
