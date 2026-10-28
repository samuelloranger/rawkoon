import Foundation

/// Layout rules for the Activity inbox: day sections, a short release summary,
/// and which version notice a duplicate hides. Pure so it is unit-tested on Linux.
public enum NotificationLedger {
    /// The heading a notification files under.
    public enum Day: Hashable, Sendable {
        case today
        case yesterday
        /// Within the last week: named by weekday. Carries the day's start.
        case thisWeek(Date)
        /// Older: named by date. Carries the day's start.
        case older(Date)
    }

    public struct Section<Item>: Identifiable {
        public let day: Day
        public let items: [Item]
        public var id: Day {
            day
        }
    }

    public static func day(for date: Date, now: Date, calendar: Calendar = .current) -> Day {
        let start = calendar.startOfDay(for: date)
        let today = calendar.startOfDay(for: now)
        let days = calendar.dateComponents([.day], from: start, to: today).day ?? 0
        switch days {
        case ...0: return .today
        case 1: return .yesterday
        case 2 ... 6: return .thisWeek(start)
        default: return .older(start)
        }
    }

    /// Splits a newest-first list into consecutive day sections, keeping its order.
    /// An item without a readable date joins the section above it.
    public static func sections<Item>(
        _ items: [Item], date: (Item) -> Date?, now: Date, calendar: Calendar = .current
    ) -> [Section<Item>] {
        var result: [Section<Item>] = []
        var current: (day: Day, items: [Item])?
        for item in items {
            let itemDay = date(item).map { day(for: $0, now: now, calendar: calendar) } ?? current?.day ?? .today
            if let open = current, open.day == itemDay {
                current?.items.append(item)
            } else {
                if let open = current {
                    result.append(Section(day: open.day, items: open.items))
                }
                current = (itemDay, [item])
            }
        }
        if let open = current {
            result.append(Section(day: open.day, items: open.items))
        }
        return result
    }

    /// "VFQ 1080p WEB · MTLQC" from a scene release name: language, resolution,
    /// HDR and source, then the group. Nil when the name has no year, episode
    /// code or resolution to anchor on, since then it isn't a scene name.
    public static func releaseSummary(_ release: String) -> String? {
        let allTokens = release
            .split(whereSeparator: { ".  _[]()".contains($0) })
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "-…")) }
            .filter { !$0.isEmpty }
        // Title words come first; reading them would turn "Charlotte's Web" into a WEB source.
        guard let start = allTokens.firstIndex(where: isAnchor) else { return nil }
        let tokens = allTokens[start...]

        var languages: [String] = []
        var resolution: String?
        var hdr: (rank: Int, label: String)?
        var source: String?

        for token in tokens {
            let upper = token.uppercased()
            // The last token carries the group ("H265-MTLQC"); its codec half still counts.
            let head = upper.split(separator: "-").first.map(String.init) ?? upper
            for candidate in Set([upper, head]) {
                if let language = languageTags[candidate], languages.count < 2, !languages.contains(language) {
                    languages.append(language)
                }
                if resolution == nil, let value = resolutions[candidate] {
                    resolution = value
                }
                if let value = hdrTags[candidate], value.rank > (hdr?.rank ?? -1) {
                    hdr = value
                }
                if source == nil, let value = sources[candidate] {
                    source = value
                }
            }
        }

        let quality = (languages + [resolution, hdr?.label, source].compactMap(\.self)).joined(separator: " ")
        let group = releaseGroup(release)
        switch (quality.isEmpty, group) {
        case (true, nil): return nil
        case (true, let group?): return group
        case (false, nil): return quality
        case (false, let group?): return "\(quality) · \(group)"
        }
    }

    /// One version announced twice: the server's "updated to vX" notice and the
    /// release notice for the same tag. The release notice has the summary, so
    /// the update notice is the one to hide.
    public struct VersionNotice: Sendable {
        public let id: Int
        /// The version an `app-update` notice says was installed.
        public let installed: String?
        /// The tags a `github-release` notice announces.
        public let announced: [String]

        public init(id: Int, installed: String?, announced: [String]) {
            self.id = id
            self.installed = installed
            self.announced = announced
        }
    }

    public static func hiddenUpdateNotices(_ notices: [VersionNotice]) -> Set<Int> {
        let announced = Set(notices.flatMap(\.announced).map(normalizedVersion))
        return Set(notices.compactMap { notice in
            guard let installed = notice.installed, announced.contains(normalizedVersion(installed)) else {
                return nil
            }
            return notice.id
        })
    }

    /// What a row names: the title, its episode or season code, and a detail.
    public struct Subject: Equatable, Sendable {
        public let title: String
        public let code: String?
        public let detail: String?

        public init(title: String, code: String?, detail: String?) {
            self.title = title
            self.code = code
            self.detail = detail
        }
    }

    /// Reads a notification sent before the server added structured fields.
    /// Its body opens with "Title (Year)"; after " — " comes a quoted episode
    /// name or a release name. Nil when the body doesn't open that way.
    public static func legacySubject(title: String, body: String) -> Subject? {
        guard let match = body.firstMatch(of: /^(.+?) \((\d{4})\)/) else { return nil }
        let name = String(match.1)
        let code = title.firstMatch(of: /S\d{2}(E\d{2})?/).map { String($0.0) }
        let rest = body[match.range.upperBound...]
        guard rest.hasPrefix(" — ") else { return Subject(title: name, code: code, detail: nil) }
        let tail = rest.dropFirst(3).trimmingCharacters(in: .whitespaces)
        if let quoted = tail.firstMatch(of: /[«“"]\s*(.+?)\s*[»”"]/) {
            return Subject(title: name, code: code, detail: String(quoted.1))
        }
        // "S01E04 is now in your library." says nothing the status word doesn't.
        if let code, tail.hasPrefix(code) {
            return Subject(title: name, code: code, detail: nil)
        }
        return Subject(title: name, code: code, detail: tail.isEmpty ? nil : tail)
    }

    /// "Show (2026)" → "Show": the year is noise on a one-line row.
    public static func strippingYear(_ label: String) -> String {
        guard let match = label.firstMatch(of: /^(.+?) \(\d{4}\)$/) else { return label }
        return String(match.1)
    }

    public static func parseDate(_ iso: String) -> Date? {
        withFraction.date(from: iso) ?? plain.date(from: iso)
    }

    // MARK: Private

    private static func isAnchor(_ token: String) -> Bool {
        let upper = token.uppercased()
        return resolutions[upper] != nil
            || upper.wholeMatch(of: /(19|20)\d{2}/) != nil
            || upper.wholeMatch(of: /S\d{1,2}(E\d{1,3})?/) != nil
    }

    private static func releaseGroup(_ release: String) -> String? {
        let trimmed = release.trimmingCharacters(in: .whitespaces)
        // The server cuts long names with "…", which would leave half a group.
        guard !trimmed.hasSuffix("…"), let dash = trimmed.lastIndex(of: "-") else { return nil }
        let group = trimmed[trimmed.index(after: dash)...]
        let lastToken = trimmed.split(whereSeparator: { ". _".contains($0) }).last.map(String.init) ?? ""
        // A group is one short word, and the "DL" of a trailing "WEB-DL" is not one.
        guard (2 ... 16).contains(group.count), group.allSatisfy({ $0.isLetter || $0.isNumber }),
              sources[lastToken.uppercased()] == nil
        else { return nil }
        return String(group)
    }

    private static func normalizedVersion(_ version: String) -> String {
        let lowered = version.trimmingCharacters(in: .whitespaces).lowercased()
        return lowered.hasPrefix("v") ? String(lowered.dropFirst()) : lowered
    }

    private static let languageTags: [String: String] = [
        "MULTI": "MULTi", "VFQ": "VFQ", "VFF": "VFF", "VF2": "VF2", "VFI": "VFI",
        "TRUEFRENCH": "TRUEFRENCH", "FRENCH": "FRENCH", "VOSTFR": "VOSTFR",
    ]

    private static let resolutions: [String: String] = [
        "2160P": "2160p", "4K": "2160p", "UHD": "2160p",
        "1080P": "1080p", "720P": "720p", "576P": "576p", "480P": "480p",
    ]

    private static let hdrTags: [String: (rank: Int, label: String)] = [
        "DV": (3, "DV"), "DOVI": (3, "DV"),
        "HDR10+": (2, "HDR10+"), "HDR10PLUS": (2, "HDR10+"),
        "HDR10": (1, "HDR"), "HDR": (1, "HDR"), "H-DR": (1, "HDR"),
    ]

    private static let sources: [String: String] = [
        "WEB": "WEB", "WEB-DL": "WEB", "WEBDL": "WEB", "WEBRIP": "WEB",
        "BLURAY": "BluRay", "BDRIP": "BluRay", "BRRIP": "BluRay",
        "REMUX": "Remux", "HDTV": "HDTV", "DVDRIP": "DVD",
    ]

    private nonisolated(unsafe) static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private nonisolated(unsafe) static let plain = ISO8601DateFormatter()
}
