import Foundation

/// How a shelf orders its titles. The server sends `manual`, `release`, `rating`
/// or `added`; anything else is read as by hand, as the server does.
public enum ShelfOrderMode: String, CaseIterable, Codable, Sendable {
    case manual, release, rating, added

    public init(serverValue: String?) {
        self = ShelfOrderMode(rawValue: serverValue ?? "") ?? .manual
    }
}

/// A month and a day, the shape a shelf's yearly window is stored in (`11-01`).
/// Both bounds are inclusive, and a window may wrap the year end.
public struct MonthDay: Hashable, Sendable, Comparable {
    public let month: Int
    public let day: Int

    /// Days each month reaches in a leap year, so `02-29` is a real day and
    /// `02-31` is refused: a saved window that no date matches would never show.
    private static let daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

    public init?(month: Int, day: Int) {
        guard (1 ... 12).contains(month), day >= 1,
              day <= Self.daysInMonth[month - 1]
        else { return nil }
        self.month = month
        self.day = day
    }

    /// Parses the server's `MM-DD`; nil for a missing or impossible day.
    public init?(_ raw: String?) {
        guard let raw, raw.count == 5 else { return nil }
        let parts = raw.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let month = Int(parts[0]), let day = Int(parts[1])
        else { return nil }
        self.init(month: month, day: day)
    }

    /// The server's `MM-DD`.
    public var raw: String {
        String(format: "%02d-%02d", month, day)
    }

    public static func < (lhs: MonthDay, rhs: MonthDay) -> Bool {
        (lhs.month, lhs.day) < (rhs.month, rhs.day)
    }

    /// Whether [date] falls inside a window from [from] to [to], both ends
    /// included. A window with one bound runs from (or to) that day; one with
    /// neither always matches.
    public static func isWithin(from: MonthDay?, to: MonthDay?, date: Date, calendar: Calendar = .current) -> Bool {
        guard from != nil || to != nil else { return true }
        guard let today = MonthDay(
            month: calendar.component(.month, from: date),
            day: calendar.component(.day, from: date)
        ) else { return false }
        switch (from, to) {
        case let (from?, to?):
            return from <= to
                ? today >= from && today <= to
                : today >= from || today <= to
        case let (from?, nil):
            return today >= from
        case let (nil, to?):
            return today <= to
        case (nil, nil):
            return true
        }
    }
}

/// Moving a row in a list, the way SwiftUI's `onMove` reports it, kept as a pure
/// function so the reorder rules can be tested without a view.
public enum ShelfMove {
    public static func move<T>(_ items: [T], from source: IndexSet, to destination: Int) -> [T] {
        var result = items
        let moving = source.sorted().map { items[$0] }
        for index in source.sorted(by: >) {
            result.remove(at: index)
        }
        // `destination` counts positions in the list before the move; drop the
        // moved rows that sat above it so the insertion point lands right
        let dropped = source.filter { $0 < destination }.count
        let at = min(max(destination - dropped, 0), result.count)
        result.insert(contentsOf: moving, at: at)
        return result
    }
}
