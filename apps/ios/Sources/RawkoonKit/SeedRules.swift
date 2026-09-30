import Foundation

/// A sharing target: release a torrent once it reaches `ratio` or has shared for
/// `seedTimeMins`, whichever comes first. Both nil means "release on import".
public struct SeedRule: Equatable, Sendable {
    public var ratio: Double?
    public var seedTimeMins: Int?

    public init(ratio: Double?, seedTimeMins: Int? = nil) {
        self.ratio = ratio
        self.seedTimeMins = seedTimeMins
    }
}

public enum SeedRuleSummary: Equatable, Sendable {
    case releaseOnImport
    case ratio(Double)
    case time(minutes: Int)
    case ratioOrTime(Double, minutes: Int)
}

public enum ParsedRatio: Equatable, Sendable {
    /// Empty field: no ratio target.
    case none
    case value(Double)
    case invalid
}

/// Pure sharing-rule helpers, mirroring the web `ruleDraft`.
public enum SeedRuleLogic {
    /// Accepts a decimal comma; a negative or non-numeric entry is invalid.
    public static func parseRatio(_ raw: String) -> ParsedRatio {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return .none
        }
        guard let value = Double(trimmed.replacingOccurrences(of: ",", with: ".")),
              value.isFinite, value >= 0
        else {
            return .invalid
        }
        return .value(value)
    }

    /// The API treats a 0 target as "no target", never as "met immediately".
    public static func rule(ratio: ParsedRatio, seedTimeMins: Int? = nil) -> SeedRule? {
        switch ratio {
        case .invalid: nil
        case .none: SeedRule(ratio: nil, seedTimeMins: positive(seedTimeMins))
        case let .value(v): SeedRule(ratio: v > 0 ? v : nil, seedTimeMins: positive(seedTimeMins))
        }
    }

    public static func summary(_ rule: SeedRule) -> SeedRuleSummary {
        let ratio = rule.ratio.flatMap { $0 > 0 ? $0 : nil }
        let time = positive(rule.seedTimeMins)
        switch (ratio, time) {
        case let (r?, t?): return .ratioOrTime(r, minutes: t)
        case let (r?, nil): return .ratio(r)
        case let (nil, t?): return .time(minutes: t)
        case (nil, nil): return .releaseOnImport
        }
    }

    /// Whole days when the time divides evenly, otherwise hours to one decimal.
    public static func duration(minutes: Int) -> (count: Double, isDays: Bool) {
        if minutes % 1440 == 0 {
            return (Double(minutes / 1440), true)
        }
        return ((Double(minutes) / 60 * 10).rounded() / 10, false)
    }

    public static func formatRatio(_ value: Double) -> String {
        String(format: "%.1f", value)
    }

    /// The text to prefill a ratio field with; empty when there is no target.
    public static func ratioText(_ ratio: Double?) -> String {
        guard let ratio, ratio > 0 else { return "" }
        return ratio == ratio.rounded() ? String(Int(ratio)) : String(ratio)
    }

    private static func positive(_ minutes: Int?) -> Int? {
        minutes.flatMap { $0 > 0 ? $0 : nil }
    }
}
