@testable import RawkoonKit
import XCTest

final class RootTabTests: XCTestCase {
    func testPhoneBarHoldsSevenTabsInOrder() {
        XCTAssertEqual(RootTab.phone, [.home, .library, .books, .discover, .explore, .notifications, .settings])
    }

    func testSidebarOrderGroupsLibraryDiscoverAndPipeline() {
        XCTAssertEqual(RootTab.sidebar, [
            .home, .library, .books, .watchlist, .discover, .explore,
            .activity, .requests, .notifications, .settings, .server,
        ])
    }

    func testServerIsAdminOnly() {
        XCTAssertTrue(RootTab.visibleSidebar(isAdmin: true).contains(.server))
        XCTAssertFalse(RootTab.visibleSidebar(isAdmin: false).contains(.server))
        XCTAssertEqual(RootTab.visibleSidebar(isAdmin: false).count, RootTab.sidebar.count - 1)
    }

    func testPhoneNeverShowsSidebarOnlyTabs() {
        for tab in [RootTab.activity, .requests, .watchlist, .server] {
            XCTAssertFalse(RootTab.phone.contains(tab))
        }
    }

    func testStaleServerPickFallsBackToHomeForNonAdmins() {
        XCTAssertEqual(RootTab.validated("server", compact: false, isAdmin: false), .home)
        XCTAssertEqual(RootTab.validated("server", compact: false, isAdmin: true), .server)
        XCTAssertEqual(RootTab.validated("watchlist", compact: true), .home)
    }

    func testEveryPhoneTabSurvivesValidationOnPhone() {
        for tab in RootTab.phone {
            XCTAssertEqual(RootTab.validated(tab.rawValue, compact: true), tab)
        }
    }

    func testNotificationsIsInTheSidebar() {
        XCTAssertEqual(RootTab.validated("notifications", compact: false), .notifications)
    }

    /// Home is the landing tab, so every fallback lands there.
    func testUnknownValueFallsBackToHome() {
        XCTAssertEqual(RootTab.validated("nope", compact: true), .home)
        XCTAssertEqual(RootTab.validated("", compact: false), .home)
    }

    func testDebugSelectionAcceptsTabNames() {
        XCTAssertEqual(RootTab.debugSelection("notifications"), .notifications)
        XCTAssertEqual(RootTab.debugSelection("explore"), .explore)
    }

    /// Existing screenshot scripts pass the old five-tab indices; they keep their meaning.
    func testDebugSelectionKeepsTheLegacyIndices() {
        XCTAssertEqual(RootTab.debugSelection("0"), .home)
        XCTAssertEqual(RootTab.debugSelection("4"), .settings)
        XCTAssertNil(RootTab.debugSelection("9"))
        XCTAssertNil(RootTab.debugSelection("bogus"))
    }
}
