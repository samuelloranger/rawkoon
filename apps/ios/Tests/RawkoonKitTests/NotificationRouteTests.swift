@testable import RawkoonKit
import XCTest

final class NotificationRouteTests: XCTestCase {
    func testLibraryItemWithEpisodeAndManagementTab() {
        XCTAssertEqual(
            NotificationRoute.parse("/library/42?season=2&episode=5&tab=management"),
            .media(libraryId: 42, season: 2, episode: 5, focusManagement: true)
        )
        XCTAssertEqual(
            NotificationRoute.parse("/library/42?season=2&episode=5&tab=files"),
            .media(libraryId: 42, season: 2, episode: 5, focusManagement: true)
        )
        XCTAssertEqual(
            NotificationRoute.parse("/library/7"),
            .media(libraryId: 7, season: nil, episode: nil, focusManagement: false)
        )
    }

    func testBookByIdOnly() {
        XCTAssertEqual(NotificationRoute.parse("/books/12"), .book(bookId: 12))
        XCTAssertNil(NotificationRoute.parse("/books"))
        XCTAssertNil(NotificationRoute.parse("/books/authors"))
    }

    func testActivityPaths() {
        XCTAssertEqual(NotificationRoute.parse("/activity/requests"), .requests)
        XCTAssertEqual(NotificationRoute.parse("/activity/calendar"), .calendar(date: nil))
        XCTAssertEqual(NotificationRoute.parse("/activity/calendar?date=2026-10-16"), .calendar(date: "2026-10-16"))
    }

    func testSettingsPaths() {
        XCTAssertEqual(NotificationRoute.parse("/settings/reencode"), .reencode)
        XCTAssertEqual(NotificationRoute.parse("/settings/alerts"), .alerts)
        XCTAssertEqual(NotificationRoute.parse("/settings/updates"), .updates)
        XCTAssertEqual(NotificationRoute.parse("/settings/connections"), .downloadClient)
    }

    func testInboxAndWatchlistPaths() {
        XCTAssertEqual(NotificationRoute.parse("/activity"), .inbox)
        XCTAssertEqual(NotificationRoute.parse("/find/watchlist"), .watchlist)
    }

    func testPagesWithoutAScreenStayUnrouted() {
        XCTAssertNil(NotificationRoute.parse("/activity/queue"))
        XCTAssertNil(NotificationRoute.parse("/settings"))
        XCTAssertNil(NotificationRoute.parse("/settings/users"))
        XCTAssertNil(NotificationRoute.parse("/settings?tab=users"))
        XCTAssertNil(NotificationRoute.parse("/nope"))
        XCTAssertNil(NotificationRoute.parse(""))
        XCTAssertNil(NotificationRoute.parse(nil))
        XCTAssertNil(NotificationRoute.parse("/library/downloads"))
        XCTAssertNil(NotificationRoute.parse("/books?search=dune"))
    }

    func testLegacyPathsStillResolve() {
        XCTAssertEqual(NotificationRoute.parse("/requests"), .requests)
        XCTAssertEqual(NotificationRoute.parse("/notifications"), .inbox)
        XCTAssertEqual(NotificationRoute.parse("/calendar?date=2026-10-16"), .calendar(date: "2026-10-16"))
        XCTAssertEqual(NotificationRoute.parse("/calendar"), .calendar(date: nil))
        XCTAssertEqual(NotificationRoute.parse("/watchlist"), .watchlist)
        XCTAssertEqual(NotificationRoute.parse("/settings?tab=transcode"), .reencode)
        XCTAssertEqual(NotificationRoute.parse("/settings?tab=notifications"), .alerts)
        XCTAssertEqual(NotificationRoute.parse("/settings?tab=releases"), .updates)
    }
}
