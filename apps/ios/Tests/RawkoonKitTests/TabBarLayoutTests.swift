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

    // MARK: - Mini player placement

    private let bar = TabBarLayout.Size(width: 361, height: 54)
    private let collapsedBar = TabBarLayout.Size(width: 54, height: 54)

    func testExpandedMiniPlayerSpansTheWidthAboveTheBar() {
        let frames = TabBarLayout.chrome(width: 361, bar: bar, miniPlayerHeight: 68, collapsed: false)
        XCTAssertEqual(frames.bar, TabBarLayout.Frame(x: 0, y: 76, width: 361, height: 54))
        XCTAssertEqual(frames.miniPlayer, TabBarLayout.Frame(x: 0, y: 0, width: 361, height: 68))
    }

    func testCollapsedMiniPlayerFillsTheRestOfTheBarRowCentredOnIt() {
        let frames = TabBarLayout.chrome(width: 361, bar: collapsedBar, miniPlayerHeight: 68, collapsed: true)
        XCTAssertEqual(frames.bar, TabBarLayout.Frame(x: 0, y: 76, width: 54, height: 54))
        XCTAssertEqual(frames.miniPlayer, TabBarLayout.Frame(x: 62, y: 69, width: 299, height: 68))
    }

    /// The reserved height is the expanded stack's, so list margins never change on collapse.
    func testHeightIsTheExpandedStackInBothStates() {
        XCTAssertEqual(TabBarLayout.chrome(width: 361, bar: bar, miniPlayerHeight: 68, collapsed: false).height, 130)
        XCTAssertEqual(TabBarLayout.chrome(width: 361, bar: collapsedBar, miniPlayerHeight: 68, collapsed: true).height, 130)
    }

    func testWithoutAMiniPlayerOnlyTheBarIsPlaced() {
        let frames = TabBarLayout.chrome(width: 361, bar: bar, miniPlayerHeight: nil, collapsed: false)
        XCTAssertEqual(frames.bar, TabBarLayout.Frame(x: 0, y: 0, width: 361, height: 54))
        XCTAssertNil(frames.miniPlayer)
        XCTAssertEqual(frames.height, 54)
    }
}
