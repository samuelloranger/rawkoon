import Foundation

/// Which episodes of a show an add, request or "Manage seasons" save monitors.
public enum SeasonMode: String, CaseIterable, Sendable, Codable {
    case all, future, latest, pick
}

/// One regular season as TMDB describes it before the show has episodes of its own.
public struct SeasonInfo: Equatable, Sendable, Identifiable {
    public let number: Int
    /// Zero for an announced season that has no episode list yet.
    public let episodes: Int
    /// `yyyy-MM-dd`; nil when TMDB has no date.
    public let airDate: String?
    /// Episodes already aired, when episode air dates are known (a show in the library); nil derives it from `airDate`.
    public let aired: Int?

    public var id: Int {
        number
    }

    public init(number: Int, episodes: Int, airDate: String?, aired: Int? = nil) {
        self.number = number
        self.episodes = episodes
        self.airDate = airDate
        self.aired = aired
    }
}

/// The season choice that rides along with an add, a request or an approval.
public struct SeasonChoice: Equatable, Sendable {
    public var mode: SeasonMode
    public var picked: [Int]
    public var monitorNew: Bool

    public init(mode: SeasonMode, picked: [Int] = [], monitorNew: Bool) {
        self.mode = mode
        self.picked = picked.sorted()
        self.monitorNew = mode == .future ? true : monitorNew
    }

    /// The server rejects `seasons` unless the mode is pick.
    public var seasonsPayload: [Int]? {
        mode == .pick ? picked : nil
    }
}

/// What the strip draws and the summary sentence says; pure so it can be tested.
public enum SeasonPlan {
    /// Specials (season 0) never appear in the picker.
    public static func regular(_ seasons: [SeasonInfo]) -> [SeasonInfo] {
        seasons.filter { $0.number >= 1 }.sorted { $0.number < $1.number }
    }

    /// `today` is `yyyy-MM-dd`, so a plain string compare orders it correctly.
    public static func isAired(_ season: SeasonInfo, today: String) -> Bool {
        guard let airDate = season.airDate, !airDate.isEmpty else { return false }
        return airDate <= today
    }

    /// Today as `yyyy-MM-dd` in UTC, the zone TMDB air dates are read in.
    public static func today(_ now: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: now)
    }

    /// An announced season has no episodes listed yet.
    public static func isAnnounced(_ season: SeasonInfo) -> Bool {
        season.episodes == 0
    }

    /// The most recent season with an aired date; an announced one never counts.
    public static func latestSeason(_ seasons: [SeasonInfo], today: String) -> Int? {
        regular(seasons).last { isAired($0, today: today) && !isAnnounced($0) }?.number
    }

    /// Seasons with episodes listed; an announced one is left out of counts and spans.
    public static func released(_ seasons: [SeasonInfo]) -> [SeasonInfo] {
        regular(seasons).filter { !isAnnounced($0) }
    }

    public static func announced(_ seasons: [SeasonInfo]) -> [SeasonInfo] {
        regular(seasons).filter(isAnnounced)
    }

    /// How many of a season's episodes have aired.
    public static func airedEpisodes(_ season: SeasonInfo, today: String) -> Int {
        min(season.aired ?? (isAired(season, today: today) ? season.episodes : 0), season.episodes)
    }

    /// One flag per episode: will it be grabbed under `choice`.
    public static func litEpisodes(_ season: SeasonInfo, choice: SeasonChoice, latest: Int?, today: String) -> [Bool] {
        let aired = airedEpisodes(season, today: today)
        return (0 ..< season.episodes).map { index in
            switch choice.mode {
            case .all: true
            case .future: index >= aired
            case .latest: season.number == latest || index >= aired
            case .pick: choice.picked.contains(season.number)
            }
        }
    }

    /// The seasons whose episodes get monitored under `choice`.
    public static func monitored(_ seasons: [SeasonInfo], choice: SeasonChoice, today: String) -> Set<Int> {
        let all = regular(seasons)
        switch choice.mode {
        case .all:
            return Set(all.map(\.number))
        case .future:
            return Set(all.filter { !isAired($0, today: today) }.map(\.number))
        case .latest:
            let latest = latestSeason(all, today: today)
            return Set(all.filter { !isAired($0, today: today) || $0.number == latest }.map(\.number))
        case .pick:
            return Set(choice.picked).intersection(all.map(\.number))
        }
    }

    public struct Summary: Equatable, Sendable {
        public let episodes: Int
        /// `1–3, 5` style, empty when nothing is selected.
        public let seasonList: String
        public let monitorNew: Bool
        public let futureOnly: Bool
    }

    public static func summary(_ seasons: [SeasonInfo], choice: SeasonChoice, today: String) -> Summary {
        let latest = latestSeason(seasons, today: today)
        var episodes = 0
        var numbers: [Int] = []
        for season in released(seasons) {
            let lit = litEpisodes(season, choice: choice, latest: latest, today: today).filter(\.self).count
            episodes += lit
            if lit > 0 {
                numbers.append(season.number)
            }
        }
        return Summary(
            episodes: episodes,
            seasonList: ranges(numbers),
            monitorNew: choice.monitorNew,
            futureOnly: choice.mode == .future
        )
    }

    /// `[1,2,3,5]` → `1–3, 5`.
    public static func ranges(_ numbers: [Int]) -> String {
        var parts: [String] = []
        var index = 0
        while index < numbers.count {
            var end = index
            while end + 1 < numbers.count, numbers[end + 1] == numbers[end] + 1 {
                end += 1
            }
            parts.append(end == index ? "\(numbers[index])" : "\(numbers[index])\u{2013}\(numbers[end])")
            index = end + 1
        }
        return parts.joined(separator: ", ")
    }
}

/// How a requester's button reads for their season choice.
public enum RequestLabel: Equatable, Sendable {
    case everything, newEpisodes, latestSeason
    case season(Int)
    case seasons(Int)

    public static func resolve(_ choice: SeasonChoice) -> RequestLabel {
        switch choice.mode {
        case .all: .everything
        case .future: .newEpisodes
        case .latest: .latestSeason
        case .pick: choice.picked.count == 1 ? .season(choice.picked[0]) : .seasons(choice.picked.count)
        }
    }
}

/// When the add sheet is worth showing; everything else keeps today's instant add.
public enum AddDialogPolicy {
    public enum Subject: Sendable {
        case movie, show, book
    }

    public static func needsDialog(
        _ subject: Subject, isAdmin: Bool, askBeforeAdding: Bool, requestersChooseSeasons: Bool,
        movieProfileCount: Int
    ) -> Bool {
        guard askBeforeAdding else { return false }
        if !isAdmin {
            return subject == .show && requestersChooseSeasons
        }
        switch subject {
        case .movie: return movieProfileCount >= 2
        case .show, .book: return true
        }
    }

    /// A one-kind profile serves its own format; only a "both" profile serves both. An unknown kind stays offered.
    public static func bookProfileMatches(profileKind: String?, format: BookFormat) -> Bool {
        guard let profileKind else { return true }
        return profileKind == "both" || (format != .both && profileKind == format.rawValue)
    }
}

public enum BookFormat: String, CaseIterable, Sendable {
    case ebook, audiobook, both

    /// The `kinds` the add endpoints take.
    public var kinds: [String] {
        self == .both ? ["ebook", "audiobook"] : [rawValue]
    }
}
