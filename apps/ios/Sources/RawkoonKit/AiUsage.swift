import Foundation

/// Pure helpers behind the AI settings screen: number formatting, price/budget
/// input rules and how an AI-pick failure maps onto what the release sheet shows.
public enum AiUsage {
    public static let dash = "\u{2014}"

    /// USD with two decimals, four below one cent so tiny spends do not read as zero.
    public static func cost(_ value: Double?) -> String {
        guard let value else { return dash }
        if value == 0 {
            return "$0.00"
        }
        return value < 0.01 ? String(format: "$%.4f", value) : String(format: "$%.2f", value)
    }

    /// Compact count: 950, 1.2K, 3.4M, 1.1B.
    public static func tokens(_ value: Int?) -> String {
        guard let value else { return dash }
        let magnitude = Double(abs(value))
        let units: [(Double, String)] = [(1e9, "B"), (1e6, "M"), (1e3, "K")]
        for (scale, suffix) in units where magnitude >= scale {
            return trimmed(Double(value) / scale) + suffix
        }
        return String(value)
    }

    public static func milliseconds(_ value: Double?) -> String {
        guard let value else { return dash }
        return value >= 1000 ? String(format: "%.1f s", value / 1000) : "\(Int(value.rounded())) ms"
    }

    /// `0.874` becomes `87.4%`; a whole number drops the decimal.
    public static func percent(_ rate: Double) -> String {
        trimmed(rate * 100) + "%"
    }

    /// Share of compared picks the AI changed, or nil when nothing was compared.
    public static func changedShare(agreementRate: Double?) -> Double? {
        agreementRate.map { 1 - $0 }
    }

    private static func trimmed(_ value: Double) -> String {
        let text = String(format: "%.1f", value)
        return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
    }

    // MARK: Price / budget fields

    /// A blank or invalid field clears the stored value (sent as null).
    public static func parsePrice(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !trimmed.isEmpty, let value = Double(trimmed), value.isFinite, value >= 0 else {
            return nil
        }
        return value
    }

    public static func priceText(_ value: Double?) -> String {
        guard let value else { return "" }
        let whole = value.rounded()
        return value == whole && abs(value) < 1e15 ? String(Int(whole)) : String(value)
    }

    /// A budget is measured in estimated cost, so it needs at least one price.
    public static func budgetNeedsPrices(budget: Double?, inputPrice: Double?, outputPrice: Double?) -> Bool {
        budget != nil && inputPrice == nil && outputPrice == nil
    }

    // MARK: Today tile

    public static func budgetReached(spend: Double?, budget: Double?, pricesConfigured: Bool) -> Bool {
        guard pricesConfigured, let spend, let budget else { return false }
        return spend >= budget
    }

    /// 0...1 progress of today's spend against the budget.
    public static func budgetRatio(spend: Double?, budget: Double?) -> Double {
        guard let spend, let budget, budget > 0 else { return 0 }
        return min(1, spend / budget)
    }

    /// Settled grabs that failed, or nil when none have settled yet.
    public static func failureRate(completed: Int, failed: Int) -> Double? {
        let settled = completed + failed
        return settled > 0 ? Double(failed) / Double(settled) : nil
    }

    /// The largest value on a chart axis; never below 1 so an empty chart still has a scale.
    public static func chartMax(_ values: [Double]) -> Double {
        max(1, values.max() ?? 0)
    }
}

/// What the interactive release sheet does when an AI pick request fails.
public enum AiPickFailure: Equatable, Sendable {
    /// 404: the interactive feature was switched off after the sheet loaded; hide the banner.
    case featureOff
    /// 429: the daily budget is spent; show a calm note, no retry.
    case budgetReached
    case failed

    public static func from(status: Int?) -> AiPickFailure {
        switch status {
        case 404: .featureOff
        case 429: .budgetReached
        default: .failed
        }
    }
}
