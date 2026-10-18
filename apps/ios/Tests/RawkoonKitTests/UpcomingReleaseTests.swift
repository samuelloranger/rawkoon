@testable import RawkoonKit
import XCTest

final class UpcomingReleaseTests: XCTestCase {
    /// Late evening in Montréal is already the next day in UTC.
    private let now = ISO8601DateFormatter().date(from: "2026-10-19T02:30:00Z")!
    private let montreal: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Montreal")!
        return calendar
    }()

    private func day(
        _ iso: String?, type: String = "movie", status: String = "wanted"
    ) -> Date? {
        UpcomingRelease.day(type: type, status: status, digitalReleaseDate: iso, now: now, calendar: montreal)
    }

    func testFutureDayOfAWantedMovie() throws {
        let release = try XCTUnwrap(day("2027-03-14T00:00:00.000Z"))
        XCTAssertEqual(UpcomingRelease.format(release, locale: Locale(identifier: "en_US")), "Mar 14, 2027")
    }

    func testTodayCountsByTheLocalCalendarNotUTC() {
        XCTAssertNotNil(day("2026-10-19T00:00:00.000Z"))
        XCTAssertNil(day("2026-10-18T00:00:00.000Z"))
    }

    func testPastOrMissingOrMalformedDayIsNil() {
        XCTAssertNil(day("2026-01-02T00:00:00.000Z"))
        XCTAssertNil(day(nil))
        XCTAssertNil(day("soon"))
    }

    func testOnlyWantedMovies() {
        XCTAssertNil(day("2027-03-14T00:00:00.000Z", type: "show"))
        XCTAssertNil(day("2027-03-14T00:00:00.000Z", status: "downloading"))
    }
}
