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

    func testUnknownValueFallsBackToLibrary() {
        XCTAssertEqual(RootTab.validated("nope", compact: true), .library)
        XCTAssertEqual(RootTab.validated("", compact: false), .library)
    }
}
