@testable import RawkoonKit
import XCTest

final class NotificationBadgeTests: XCTestCase {
    func testZeroWhenNoUnread() {
        XCTAssertEqual(NotificationBadge.value(forUnread: 0), 0)
    }

    func testPassesThroughUnderCap() {
        XCTAssertEqual(NotificationBadge.value(forUnread: 7), 7)
    }

    func testClampsNegativeToZero() {
        XCTAssertEqual(NotificationBadge.value(forUnread: -3), 0)
    }

    func testCapsRunawayCount() {
        XCTAssertEqual(NotificationBadge.value(forUnread: 5000, cap: 99), 99)
    }
}
