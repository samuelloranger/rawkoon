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
    /// "manual" or "rule"; the rule fields only reach administrators.
    let source: String?
    /// Why a rule added this title; possibly empty once the rules changed.
    let reason: [String]?
    /// Removed by an administrator after rules added it; only sent when asked with `?excluded=1`.
    let excluded: Bool?

    var isMovie: Bool {
        type == "movie"
    }

    var isRuleEntry: Bool {
        source == "rule"
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
    /// Administrators only.
    let rules: ShelfRules?
    let autoJoin: Bool?
    /// Names for saved ids, keyed `keyword:<id>` / `company:<id>` / ...
    let ruleNames: [String: String]?

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

// MARK: - Rules

/// What a shelf's rules select from the library; unset fields don't constrain.
nonisolated struct ShelfRules: Codable, Hashable, Sendable {
    var types: [String]?
    var genresAny: [Int]?
    var genresNone: [Int]?
    var keywordsAny: [Int]?
    var keywordsNone: [Int]?
    var companiesAny: [Int]?
    var networksAny: [Int]?
    var tmdbCollection: Int?
    var yearMin: Int?
    var yearMax: Int?
    var votesMin: Int?
    var ratingMin: Double?
    var certifications: [String]?
}

/// The editor's form state. Numbers stay text so a half-typed field doesn't fight the user.
nonisolated struct ShelfRulesDraft: Equatable, Sendable {
    var types: [String] = []
    var genresAny: [Int] = []
    var genresNone: [Int] = []
    var keywordsAny: [Int] = []
    var keywordsNone: [Int] = []
    var companiesAny: [Int] = []
    var networksAny: [Int] = []
    var collection = ""
    var yearMin = ""
    var yearMax = ""
    var votesMin = ""
    var ratingMin = ""
    var certifications: [String] = []

    init() {}

    init(_ rules: ShelfRules?) {
        types = rules?.types ?? []
        genresAny = rules?.genresAny ?? []
        genresNone = rules?.genresNone ?? []
        keywordsAny = rules?.keywordsAny ?? []
        keywordsNone = rules?.keywordsNone ?? []
        companiesAny = rules?.companiesAny ?? []
        networksAny = rules?.networksAny ?? []
        collection = rules?.tmdbCollection.map(String.init) ?? ""
        yearMin = rules?.yearMin.map(String.init) ?? ""
        yearMax = rules?.yearMax.map(String.init) ?? ""
        votesMin = rules?.votesMin.map(String.init) ?? ""
        ratingMin = rules?.ratingMin.map { String($0) } ?? ""
        certifications = rules?.certifications ?? []
    }

    private static func integer(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if let whole = Int(trimmed) {
            return whole
        }
        return Double(trimmed.replacingOccurrences(of: ",", with: ".")).flatMap { $0.isFinite ? Int($0) : nil }
    }

    /// Unset fields are dropped, and a draft with nothing set is nil (no rules), never `{}`.
    var rules: ShelfRules? {
        var rules = ShelfRules()
        func list<T>(_ values: [T]) -> [T]? {
            values.isEmpty ? nil : values
        }
        rules.types = list(["movie", "show"].filter(types.contains))
        rules.genresAny = list(genresAny)
        rules.genresNone = list(genresNone)
        rules.keywordsAny = list(keywordsAny)
        rules.keywordsNone = list(keywordsNone)
        rules.companiesAny = list(companiesAny)
        rules.networksAny = list(networksAny)
        rules.certifications = list(
            certifications.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        )
        rules.tmdbCollection = Self.integer(collection).flatMap { $0 > 0 ? $0 : nil }
        rules.yearMin = Self.integer(yearMin)
        rules.yearMax = Self.integer(yearMax)
        rules.votesMin = Self.integer(votesMin)
        let rating = ratingMin.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        rules.ratingMin = Double(rating).flatMap { $0.isFinite ? $0 : nil }
        return rules == ShelfRules() ? nil : rules
    }
}

/// A TMDB keyword or company, for the rules search.
nonisolated struct ShelfLookupItem: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
}

nonisolated struct ShelfLookupResponse: Decodable, Sendable {
    let items: [ShelfLookupItem]
}

/// One title in a rules preview.
nonisolated struct ShelfPreviewTitle: Decodable, Identifiable, Hashable, Sendable {
    let tmdbId: Int
    let type: String
    let title: String
    let year: Int?
    let posterUrl: String?
    /// Already on the shelf (and not excluded).
    let inShelf: Bool
    /// Matches: the rule parts that selected it. Excluded: the `*_none` parts that removed it.
    let reason: [String]

    var id: String {
        "\(type)-\(tmdbId)"
    }
}

nonisolated struct ShelfPreview: Decodable, Sendable {
    let matches: [ShelfPreviewTitle]
    /// Titles a `*_none` rule removed, so an administrator can pin them in by hand.
    let excluded: [ShelfPreviewTitle]
    /// Either list was cut at the server's cap.
    let truncated: Bool
}

nonisolated struct PreviewShelfRulesBody: Encodable, Sendable {
    let rules: ShelfRules
}

/// The server reads an omitted `rules` as "unchanged", so clearing must send an explicit null.
nonisolated struct SaveShelfRulesBody: Encodable, Sendable {
    let rules: ShelfRules?

    private enum CodingKeys: String, CodingKey {
        case rules
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(rules, forKey: .rules)
    }
}

nonisolated struct ShelfAutoJoinBody: Encodable, Sendable {
    let autoJoin: Bool
}
