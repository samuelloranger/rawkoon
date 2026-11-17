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
        XCTAssertEqual(NotificationRoute.parse("/books/12/listen"), .book(bookId: 12))
        XCTAssertEqual(NotificationRoute.parse("/books"), .tab(.books))
        XCTAssertEqual(NotificationRoute.parse("/books/authors"), .tab(.books))
    }

    func testActivityPaths() {
        XCTAssertEqual(NotificationRoute.parse("/activity/requests"), .requests)
        XCTAssertEqual(NotificationRoute.parse("/activity/calendar"), .calendar(date: nil))
        XCTAssertEqual(NotificationRoute.parse("/activity/calendar?date=2026-10-16"), .calendar(date: "2026-10-16"))
        XCTAssertEqual(NotificationRoute.parse("/activity/history"), .history)
        XCTAssertEqual(NotificationRoute.parse("/activity/queue"), .queue)
    }

    func testSettingsPaths() {
        XCTAssertEqual(NotificationRoute.parse("/settings/reencode"), .settings(page: "reencode"))
        XCTAssertEqual(NotificationRoute.parse("/settings/after-download"), .settings(page: "after-download"))
        XCTAssertEqual(NotificationRoute.parse("/settings"), .tab(.settings))
    }

    func testFindAndShelfPaths() {
        XCTAssertEqual(NotificationRoute.parse("/find"), .tab(.find))
        XCTAssertEqual(NotificationRoute.parse("/find/collections"), .findShelf(.collections))
        XCTAssertEqual(NotificationRoute.parse("/find/bestsellers"), .findShelf(.bestsellers))
        XCTAssertEqual(NotificationRoute.parse("/find/swipe"), .swipe)
        XCTAssertEqual(NotificationRoute.parse("/library/shelves"), .findShelf(.shelves))
        XCTAssertEqual(NotificationRoute.parse("/library/shelves/3"), .shelf(shelfId: 3))
        XCTAssertNil(NotificationRoute.parse("/library/shelves/new"))
    }

    func testTabRoots() {
        XCTAssertEqual(NotificationRoute.parse("/"), .tab(.home))
        XCTAssertEqual(NotificationRoute.parse("/home"), .tab(.home))
        XCTAssertEqual(NotificationRoute.parse("/library"), .tab(.library))
        XCTAssertEqual(NotificationRoute.parse("/discover"), .tab(.find))
    }

    func testAppURLBecomesWebPath() throws {
        func path(_ string: String) throws -> String? {
            try NotificationRoute.webPath(fromAppURL: XCTUnwrap(URL(string: string)))
        }
        XCTAssertEqual(try path("rawkoon://library/42?season=2&episode=5"), "/library/42?season=2&episode=5")
        XCTAssertEqual(try path("rawkoon://settings/health"), "/settings/health")
        XCTAssertEqual(try path("rawkoon:///activity/requests"), "/activity/requests")
        XCTAssertEqual(try path("rawkoon://home"), "/home")
        XCTAssertEqual(try path("rawkoon://"), "/")
        XCTAssertNil(try path("https://example.com/library/42"))
    }

    func testInboxAndWatchlistPaths() {
        XCTAssertEqual(NotificationRoute.parse("/activity"), .inbox)
        XCTAssertEqual(NotificationRoute.parse("/find/watchlist"), .findShelf(.watchlist))
    }

    func testPagesWithoutAScreenStayUnrouted() {
        XCTAssertNil(NotificationRoute.parse("/settings?tab=users"))
        XCTAssertNil(NotificationRoute.parse("/nope"))
        XCTAssertNil(NotificationRoute.parse(""))
        XCTAssertNil(NotificationRoute.parse(nil))
        XCTAssertNil(NotificationRoute.parse("/library/downloads"))
    }

    func testLegacyPathsStillResolve() {
        XCTAssertEqual(NotificationRoute.parse("/requests"), .requests)
        XCTAssertEqual(NotificationRoute.parse("/notifications"), .inbox)
        XCTAssertEqual(NotificationRoute.parse("/calendar?date=2026-10-16"), .calendar(date: "2026-10-16"))
        XCTAssertEqual(NotificationRoute.parse("/calendar"), .calendar(date: nil))
        XCTAssertEqual(NotificationRoute.parse("/watchlist"), .findShelf(.watchlist))
        XCTAssertEqual(NotificationRoute.parse("/settings?tab=transcode"), .settings(page: "reencode"))
        XCTAssertEqual(NotificationRoute.parse("/settings?tab=notifications"), .settings(page: "alerts"))
        XCTAssertEqual(NotificationRoute.parse("/settings?tab=releases"), .settings(page: "updates"))
    }
}
