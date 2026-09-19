import Foundation

// Library media, episodes, file metadata, and remux DTOs. Split out of Models.swift to stay under the file_length lint
// threshold (spec §4.2). Pure data types, no behaviour.

// MARK: - Library episodes (TV)

nonisolated struct EpisodesResponse: Decodable, Sendable {
    let seasons: [SeasonEpisodes]
}

nonisolated struct SeasonEpisodes: Decodable, Sendable, Identifiable {
    let season: Int
    let episodes: [Episode]
    var id: Int {
        season
    }
}

nonisolated struct Episode: Decodable, Identifiable, Sendable {
    let id: Int
    let season: Int
    let episode: Int
    let title: String?
    let airDate: String?
    let status: String
    let monitored: Bool
    let downloadedAt: String?
}

// MARK: - Library file metadata

nonisolated struct LibraryAudioTrack: Decodable, Identifiable, Sendable {
    let index: Int
    let language: String?
    let languageName: String?
    let title: String?
    let codec: String?
    let channels: Int?
    let channelLayout: String?
    let bitrateKbps: Int?
    let isDefault: Bool
    let forced: Bool

    var id: Int {
        index
    }

    enum CodingKeys: String, CodingKey {
        case index, language, languageName, title, codec, channels, channelLayout, bitrateKbps, forced
        case isDefault = "default"
    }
}

nonisolated struct LibrarySubtitleTrack: Decodable, Identifiable, Sendable {
    let index: Int
    let language: String?
    let languageName: String?
    let title: String?
    let format: String?
    let forced: Bool
    let hearingImpaired: Bool

    var id: Int {
        index
    }
}

nonisolated struct LibraryFileInfo: Decodable, Identifiable, Sendable {
    let id: Int
    let fileName: String
    let filePath: String
    let sizeBytes: String
    let durationSecs: Double?
    let releaseGroup: String?
    let videoCodec: String?
    let videoProfile: String?
    let width: Int?
    let height: Int?
    let frameRate: Double?
    let bitDepth: Int?
    let videoBitrate: Int?
    let hdrFormat: String?
    let resolution: Int?
    let source: String?
    let audioTracks: [LibraryAudioTrack]
    let subtitleTracks: [LibrarySubtitleTrack]
    let scannedAt: String
    let season: Int?
    let episode: Int?
    let episodeTitle: String?

    enum CodingKeys: String, CodingKey {
        case id, fileName, filePath, sizeBytes, durationSecs, releaseGroup, videoCodec, videoProfile, width, height
        case frameRate, bitDepth, videoBitrate, hdrFormat, resolution, source
        case audioTracks, subtitleTracks, scannedAt, season, episode, episodeTitle
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        fileName = try c.decode(String.self, forKey: .fileName)
        filePath = try c.decode(String.self, forKey: .filePath)
        sizeBytes = try c.decode(String.self, forKey: .sizeBytes)
        durationSecs = try c.decodeIfPresent(Double.self, forKey: .durationSecs)
        releaseGroup = try c.decodeIfPresent(String.self, forKey: .releaseGroup)
        videoCodec = try c.decodeIfPresent(String.self, forKey: .videoCodec)
        videoProfile = try c.decodeIfPresent(String.self, forKey: .videoProfile)
        width = try c.decodeIfPresent(Int.self, forKey: .width)
        height = try c.decodeIfPresent(Int.self, forKey: .height)
        frameRate = try c.decodeIfPresent(Double.self, forKey: .frameRate)
        bitDepth = try c.decodeIfPresent(Int.self, forKey: .bitDepth)
        videoBitrate = try c.decodeIfPresent(Int.self, forKey: .videoBitrate)
        hdrFormat = try c.decodeIfPresent(String.self, forKey: .hdrFormat)
        resolution = try c.decodeIfPresent(Int.self, forKey: .resolution)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        audioTracks = (try? c.decode([LibraryAudioTrack].self, forKey: .audioTracks)) ?? []
        subtitleTracks = (try? c.decode([LibrarySubtitleTrack].self, forKey: .subtitleTracks)) ?? []
        scannedAt = try c.decode(String.self, forKey: .scannedAt)
        season = try c.decodeIfPresent(Int.self, forKey: .season)
        episode = try c.decodeIfPresent(Int.self, forKey: .episode)
        episodeTitle = try c.decodeIfPresent(String.self, forKey: .episodeTitle)
    }
}

nonisolated struct LibraryFilesResponse: Decodable, Sendable {
    let mediaType: String
    let files: [LibraryFileInfo]
}

// MARK: - Remux

nonisolated struct RemuxRequest: Encodable, Sendable {
    let keepAudioTrackIndices: [Int]
    let keepSubtitleTrackIndices: [Int]
}

nonisolated struct RemuxStartResponse: Decodable, Sendable {
    let jobId: String
}

nonisolated struct RemuxResult: Decodable, Sendable {
    let status: String // "remuxed" | "skipped" | "error"
    let message: String?
}

nonisolated struct RemuxFileStatus: Decodable, Sendable {
    let jobId: String?
    let state: String // unknown | active | waiting | completed | failed | delayed | paused
    let result: RemuxResult?
    let error: String?
}

// MARK: - Library media (movies / shows)

nonisolated struct LibraryMedia: Decodable, Identifiable, Sendable {
    let id: Int
    let tmdbId: Int
    let type: String // "movie" | "show"
    let title: String
    let year: Int?
    let status: String // wanted / downloading / downloaded / missing …
    // Patched optimistically by `ServerStateStore` before the server confirms.
    var monitored: Bool
    let posterUrl: String?
    /// Backdrop exists only as an override server-side (no stored column).
    let backdropUrl: String?
    let overview: String?
    /// Per-media display overrides actually set by an admin. Used to prefill the
    /// overrides editor (empty field = no override) so an unchanged save omits it.
    let overrides: LibraryMediaOverrides?
    var qualityProfileId: Int?
    var qualityProfile: LibraryQualityProfileRef?
    let totalSizeBytes: String? // bigint serialized as string
    let episodeCount: Int?
    let downloadedEpisodeCount: Int?
    let seasonCount: Int?
    let durationSecs: Double?
    // Density/ledger metadata — mirrors `libraryHelpers.ts` mapLibraryMedia.
    let resolution: Int?
    let videoCodec: String?
    let hdrFormat: String?
    let audioFormat: String?
    let languageTags: [String]?
    let lastGrabbedAt: String?
    let addedAt: String?
    let digitalReleaseDate: String?
    /// Optimistic row standing in for an add the server has not confirmed yet.
    var isProvisional = false

    /// Listed explicitly so `isProvisional` stays a client-only presentation flag.
    private enum CodingKeys: String, CodingKey {
        case id, tmdbId, type, title, year, status, monitored, posterUrl, overview
        case backdropUrl, overrides
        case qualityProfileId, qualityProfile, totalSizeBytes, episodeCount
        case downloadedEpisodeCount, seasonCount, durationSecs, resolution
        case videoCodec, hdrFormat, audioFormat, languageTags, lastGrabbedAt
        case addedAt, digitalReleaseDate
    }
}

extension LibraryMedia {
    /// Placeholder row shown between an add tap and the server's created item.
    /// The negative id cannot collide with a server id while both are visible.
    nonisolated static func provisional(
        tmdbId: Int,
        type: String,
        title: String,
        year: Int?,
        posterUrl: String?,
        overview: String?
    ) -> LibraryMedia {
        LibraryMedia(
            id: -tmdbId, tmdbId: tmdbId, type: type, title: title, year: year,
            status: "wanted", monitored: true, posterUrl: posterUrl,
            backdropUrl: nil, overview: overview, overrides: nil,
            qualityProfileId: nil, qualityProfile: nil, totalSizeBytes: nil,
            episodeCount: nil, downloadedEpisodeCount: nil, seasonCount: nil,
            durationSecs: nil, resolution: nil, videoCodec: nil, hdrFormat: nil,
            audioFormat: nil, languageTags: nil, lastGrabbedAt: nil, addedAt: nil,
            digitalReleaseDate: nil, isProvisional: true
        )
    }
}

nonisolated struct LibraryQualityProfileRef: Decodable, Sendable {
    let id: Int
    let name: String
}

/// The subset of `library_media.overrides` the iOS editor reads and writes.
nonisolated struct LibraryMediaOverrides: Decodable, Sendable {
    let title: String?
    let sortTitle: String?
    let year: Int?
    let overview: String?
    let posterUrl: String?
    let backdropUrl: String?
}

/// One override field's intent on a PATCH: `.clear` sends explicit null (removes
/// the override), `.set` sends a value. Omitting the property entirely (leaving
/// the body field nil) leaves that override untouched — the three states the
/// overrides endpoint distinguishes.
nonisolated enum OverrideValue<T: Encodable & Sendable>: Encodable, Sendable {
    case clear
    case set(T)

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .clear: try container.encodeNil()
        case let .set(value): try container.encode(value)
        }
    }
}

/// Admin PATCH body for `/api/library/:id/overrides`. A nil property is omitted
/// (untouched); a non-nil `OverrideValue` is `.clear` (null) or `.set`.
nonisolated struct UpdateLibraryOverridesBody: Encodable, Sendable {
    var title: OverrideValue<String>?
    var sortTitle: OverrideValue<String>?
    var year: OverrideValue<Int>?
    var overview: OverrideValue<String>?
    var posterUrl: OverrideValue<String>?
    var backdropUrl: OverrideValue<String>?
}

/// Poster/backdrop candidate for the artwork picker (TMDB + fanart merged).
nonisolated struct ArtworkCandidate: Decodable, Sendable, Identifiable {
    let url: String
    let thumbUrl: String
    let width: Int?
    let height: Int?
    let language: String?
    let vote: Double?
    let source: String

    var id: String {
        url
    }
}

nonisolated struct ArtworkCandidatesResponse: Decodable, Sendable {
    let candidates: [ArtworkCandidate]
}

nonisolated struct LibraryListResponse: Decodable, Sendable {
    let items: [LibraryMedia]
    let movieCount: Int?
    let showCount: Int?
    let hasMore: Bool?
}

/// Response shared by the item/season/episode manual-search endpoints
/// (`libraryGrabRoutes.ts` — `LibrarySearchResponse` in `library.ts`).
nonisolated struct LibrarySearchResponse: Decodable, Sendable {
    let grabbed: Bool
    let releaseTitle: String?
    let reason: String?
}
