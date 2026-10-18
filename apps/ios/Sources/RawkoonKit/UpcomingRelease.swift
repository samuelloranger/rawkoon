import Foundation

/// The digital release day of a wanted movie that is not out yet.
public enum UpcomingRelease {
    /// Nil for shows, titles past wanted, and once the day has come; the server stores the day as UTC midnight.
    public static func day(
        type: String, status: String, digitalReleaseDate: String?,
        now: Date = Date(), calendar: Calendar = .current
    ) -> Date? {
        guard type == "movie", status == "wanted", let iso = digitalReleaseDate,
              let day = parser.date(from: String(iso.prefix(10))) else { return nil }
        let today = calendar.dateComponents([.year, .month, .day], from: now)
        guard let todayAsUTC = utc.date(from: today) else { return nil }
        return day > todayAsUTC ? day : nil
    }

    /// "Mar 14, 2027", read in UTC so the day never slides.
    public static func format(_ day: Date, locale: Locale = .current) -> String {
        day.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: utcZone))
    }

    private static let utcZone = TimeZone(identifier: "UTC")!

    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utcZone
        return calendar
    }()

    private nonisolated(unsafe) static let parser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = utcZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
