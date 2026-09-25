@testable import RawkoonKit
import XCTest

final class RootTabTests: XCTestCase {
    func testPhoneBarHoldsSevenTabsInOrder() {
        XCTAssertEqual(RootTab.phone, [.home, .library, .books, .discover, .explore, .notifications, .settings])
    }

    func testSidebarIsUnchangedByTheCustomBar() {
        XCTAssertEqual(RootTab.sidebar, [.home, .library, .books, .discover, .explore, .settings])
    }

    func testEveryPhoneTabSurvivesValidationOnPhone() {
        for tab in RootTab.phone {
            XCTAssertEqual(RootTab.validated(tab.rawValue, compact: true), tab)
        }
    }

    /// Notifications is a phone-only tab; a stale pick on iPad must land somewhere visible.
    func testNotificationsFallsBackToHomeInTheSidebar() {
        XCTAssertEqual(RootTab.validated("notifications", compact: false), .home)
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
