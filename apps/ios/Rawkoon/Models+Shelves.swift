import Foundation
import RawkoonKit

/// One shelf as the lists show it: its name, cover and how many titles it holds.
/// JSON is snake_case; the media decoder converts it.
nonisolated struct ShelfSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let description: String?
    let cover: ShelfCover
    let entryCount: Int
    let inLibraryCount: Int
    let homeRow: Bool
    let visibleNow: Bool
    let orderMode: ShelfOrderMode
    let visibleFrom: String?
    let visibleTo: String?
    let coverTmdbId: Int?
    let coverType: String?
    let seedKey: String?
}

/// What a shelf's cover draws: a 2×2 poster mosaic, or one title's backdrop.
nonisolated enum ShelfCover: Decodable, Hashable, Sendable {
    case mosaic(posters: [String])
    case backdrop(url: String?)
    /// An image an administrator uploaded on the web; absent until one is.
    case upload(url: String?)

    private enum CodingKeys: String, CodingKey {
        case style, posters, backdropUrl, url
    }

    /// "mosaic" or "backdrop", as the editor's picker names them.
    var style: String {
        switch self {
        case .mosaic: "mosaic"
        case .backdrop: "backdrop"
        case .upload: "upload"
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .style) {
        case "backdrop":
            self = try .backdrop(url: container.decodeIfPresent(String.self, forKey: .backdropUrl))
        case "upload":
            self = try .upload(url: container.decodeIfPresent(String.self, forKey: .url))
        default:
            self = try .mosaic(posters: container.decodeIfPresent([String].self, forKey: .posters) ?? [])
        }
    }
}

/// One title on a shelf, resolved against the library.
nonisolated struct ShelfEntry: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let tmdbId: Int
    let type: String
    let season: Int?
    let title: String
    let year: Int?
    let posterUrl: String?
    var groupLabel: String?
    let position: Int
    let inLibrary: Bool
    let libraryId: Int?

    var isMovie: Bool {
        type == "movie"
    }
}

/// One shelf with its titles in display order.
nonisolated struct ShelfDetail: Decodable, Hashable, Sendable {
    let id: Int
    let name: String
    let description: String?
    let cover: ShelfCover
    let entryCount: Int
    let inLibraryCount: Int
    let homeRow: Bool
    let visibleNow: Bool
    let orderMode: ShelfOrderMode
    let visibleFrom: String?
    let visibleTo: String?
    let coverTmdbId: Int?
    let coverType: String?
    let seedKey: String?
    let entries: [ShelfEntry]

    var summary: ShelfSummary {
        ShelfSummary(
            id: id,
            name: name,
            description: description,
            cover: cover,
            entryCount: entryCount,
            inLibraryCount: inLibraryCount,
            homeRow: homeRow,
            visibleNow: visibleNow,
            orderMode: orderMode,
            visibleFrom: visibleFrom,
            visibleTo: visibleTo,
            coverTmdbId: coverTmdbId,
            coverType: coverType,
            seedKey: seedKey
        )
    }
}

nonisolated struct ShelvesResponse: Decodable, Sendable {
    let shelves: [ShelfSummary]
}

nonisolated struct ShelfResponse: Decodable, Sendable {
    let shelf: ShelfDetail
}

/// One row of the "Add to shelf" sheet.
nonisolated struct ShelfMembership: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let holds: Bool
    let entryId: Int?
    let orderMode: ShelfOrderMode
}

nonisolated struct ShelfMembershipsResponse: Decodable, Sendable {
    let shelves: [ShelfMembership]
}

/// One seed card in the "New shelf" sheet.
nonisolated struct ShelfSeed: Decodable, Identifiable, Hashable, Sendable {
    let key: String
    let name: String
    let description: String
    let orderMode: ShelfOrderMode
    let homeRow: Bool
    let visibleFrom: String?
    let visibleTo: String?

    var id: String {
        key
    }
}

nonisolated struct ShelfSeedsResponse: Decodable, Sendable {
    let seeds: [ShelfSeed]
}

// MARK: - Request bodies

nonisolated struct CreateShelfBody: Encodable, Sendable {
    var name: String?
    var seed: String?
}

nonisolated struct UpdateShelfBody: Encodable, Sendable {
    var name: String
    var description: String?
    var orderMode: ShelfOrderMode
    var homeRow: Bool
    var visibleFrom: String?
    var visibleTo: String?
    var coverStyle: String
    var coverTmdbId: Int?
    var coverType: String?
    /// Sends `cover_url: null`, dropping a backdrop picked on the web.
    var clearCoverUrl = false

    private enum CodingKeys: String, CodingKey {
        case name, description, orderMode, homeRow, visibleFrom, visibleTo
        case coverStyle, coverTmdbId, coverType, coverUrl
    }

    /// The server reads an omitted field as "unchanged", so a cleared one must go out as an explicit null.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(description, forKey: .description)
        try c.encode(orderMode, forKey: .orderMode)
        try c.encode(homeRow, forKey: .homeRow)
        try c.encode(visibleFrom, forKey: .visibleFrom)
        try c.encode(visibleTo, forKey: .visibleTo)
        try c.encode(coverStyle, forKey: .coverStyle)
        try c.encode(coverTmdbId, forKey: .coverTmdbId)
        try c.encode(coverType, forKey: .coverType)
        if clearCoverUrl {
            try c.encodeNil(forKey: .coverUrl)
        }
    }
}

nonisolated struct AddShelfEntryBody: Encodable, Sendable {
    let tmdbId: Int
    let type: String
    let season: Int?
}

nonisolated struct MoveShelfEntry: Encodable, Sendable {
    let id: Int
    let position: Int
    let groupLabel: String?
}

nonisolated struct MoveShelfEntryBody: Encodable, Sendable {
    let entries: [MoveShelfEntry]
}
