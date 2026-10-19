import Foundation

/// Day sections for the upcoming-releases calendar.
public enum UpcomingCalendar {
    public enum Relative: Equatable, Sendable {
        case today, tomorrow, other
    }

    public struct Day: Equatable, Sendable {
        public let date: Date
        public let relative: Relative
    }

    public struct Section<Item>: Identifiable {
        /// The `yyyy-MM-dd` day, or nil for the undated tail.
        public let isoDay: String?
        public let items: [Item]

        public var id: String {
            isoDay ?? "undated"
        }
    }

    /// Items bucketed by day in ascending order, server order kept within a day; undated ones last.
    /// `release_date` is a calendar day, not an instant, so its first ten characters are the key.
    public static func sections<Item>(_ items: [Item], isoDay: (Item) -> String?) -> [Section<Item>] {
        var order: [String?] = []
        var buckets: [String?: [Item]] = [:]
        for item in items {
            let key = isoDay(item).map { String($0.prefix(10)) }.flatMap { $0.isEmpty ? nil : $0 }
            if buckets[key] == nil {
                order.append(key)
            }
            buckets[key, default: []].append(item)
        }
        let dated = order.compactMap(\.self).sorted()
        var keys: [String?] = dated
        if buckets[nil] != nil {
            keys.append(nil)
        }
        return keys.map { Section(isoDay: $0, items: buckets[$0] ?? []) }
    }

    /// The day an ISO date names, read in `calendar` so the weekday matches the server's calendar day.
    public static func day(_ isoDay: String?, now: Date = Date(), calendar: Calendar = .current) -> Day? {
        guard let isoDay else { return nil }
        let parts = isoDay.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
              let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        else { return nil }
        let offset = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: date).day
        let relative: Relative = switch offset {
        case 0?: .today
        case 1?: .tomorrow
        default: .other
        }
        return Day(date: date, relative: relative)
    }

    /// "Tuesday", capitalized for a header even in languages that write weekdays lowercase.
    public static func weekday(_ date: Date, locale: Locale = .current, calendar: Calendar = .current) -> String {
        let name = date.formatted(style(locale: locale, calendar: calendar).weekday(.wide))
        return name.prefix(1).uppercased(with: locale) + name.dropFirst()
    }

    /// "October 20", with the year only when it isn't the current one.
    public static func monthDay(
        _ date: Date, now: Date = Date(), locale: Locale = .current, calendar: Calendar = .current
    ) -> String {
        let base = style(locale: locale, calendar: calendar).month(.wide).day()
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return date.formatted(sameYear ? base : base.year())
    }

    private static func style(locale: Locale, calendar: Calendar) -> Date.FormatStyle {
        Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
    }
}
