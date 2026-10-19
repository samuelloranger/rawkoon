@testable import RawkoonKit
import XCTest

final class UpcomingCalendarTests: XCTestCase {
    /// Late evening in Montréal is already the next day in UTC.
    private let now = ISO8601DateFormatter().date(from: "2026-10-19T02:30:00Z")!
    private let montreal: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Montreal")!
        return calendar
    }()

    private func day(_ iso: String?) -> UpcomingCalendar.Day? {
        UpcomingCalendar.day(iso, now: now, calendar: montreal)
    }

    func testRelativeDayFollowsTheLocalCalendar() {
        XCTAssertEqual(day("2026-10-18")?.relative, .today)
        XCTAssertEqual(day("2026-10-19")?.relative, .tomorrow)
        XCTAssertEqual(day("2026-10-20")?.relative, .other)
        XCTAssertEqual(day("2026-10-17")?.relative, .other)
    }

    func testMissingOrMalformedDayIsNil() {
        XCTAssertNil(day(nil))
        XCTAssertNil(day(""))
        XCTAssertNil(day("soon"))
    }

    func testFullTimestampsKeepTheirCalendarDay() {
        XCTAssertEqual(day("2026-10-19T00:00:00.000Z")?.relative, .tomorrow)
    }

    func testHeaderLabels() throws {
        let tuesday = try XCTUnwrap(day("2026-10-20")).date
        let french = Locale(identifier: "fr_CA")
        XCTAssertEqual(UpcomingCalendar.weekday(tuesday, locale: french, calendar: montreal), "Mardi")
        XCTAssertEqual(UpcomingCalendar.weekday(tuesday, locale: Locale(identifier: "en_US"), calendar: montreal), "Tuesday")
        XCTAssertEqual(UpcomingCalendar.monthDay(tuesday, now: now, locale: french, calendar: montreal), "20 octobre")

        let nextYear = try XCTUnwrap(day("2027-01-03")).date
        XCTAssertEqual(
            UpcomingCalendar.monthDay(nextYear, now: now, locale: Locale(identifier: "en_US"), calendar: montreal),
            "January 3, 2027"
        )
    }

    func testSectionsSortDaysAndKeepUndatedLast() {
        let items: [(String, String?)] = [("a", "2026-10-23"), ("b", nil), ("c", "2026-10-20"), ("d", "2026-10-23"), ("e", "")]
        let sections = UpcomingCalendar.sections(items) { $0.1 }
        XCTAssertEqual(sections.map(\.isoDay), ["2026-10-20", "2026-10-23", nil])
        XCTAssertEqual(sections.map { $0.items.map(\.0) }, [["c"], ["a", "d"], ["b", "e"]])
        XCTAssertEqual(sections.last?.id, "undated")
    }
}
