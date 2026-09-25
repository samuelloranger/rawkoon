@testable import RawkoonKit
import XCTest

final class TabBarLayoutTests: XCTestCase {
    private func slotWidth(_ insets: TabBarLayout.Insets, width: Double, slots: Int = 7) -> Double {
        (width - 2 * insets.margin - 2 * insets.padding) / Double(slots)
    }

    func testRoomyScreensKeepTheDesignMargins() {
        let insets = TabBarLayout.insets(containerWidth: 375, slots: 7)
        XCTAssertEqual(insets.margin, 16)
        XCTAssertEqual(insets.padding, 5)
    }

    /// Display Zoom and Slide Over leave 320pt; slots must still be 44pt hit targets.
    func testNarrowScreensShrinkMarginsToKeep44ptSlots() {
        let insets = TabBarLayout.insets(containerWidth: 320, slots: 7)
        XCTAssertGreaterThanOrEqual(slotWidth(insets, width: 320), 44)
        XCTAssertGreaterThanOrEqual(insets.margin, 0)
    }

    func testMarginsNeverGoNegativeWhenNothingFits() {
        let insets = TabBarLayout.insets(containerWidth: 200, slots: 7)
        XCTAssertEqual(insets.margin, 0)
    }
}
