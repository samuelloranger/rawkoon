@testable import RawkoonKit
import XCTest

final class TabBarScrollStateTests: XCTestCase {
    private func scrolled(_ offsets: [Double], from start: TabBarScrollState = TabBarScrollState()) -> TabBarScrollState {
        var state = start
        for offset in offsets {
            state.update(offset: offset)
        }
        return state
    }

    func testStartsExpanded() {
        XCTAssertFalse(TabBarScrollState().isCollapsed)
    }

    func testScrollingDownPastTheThresholdCollapses() {
        XCTAssertTrue(scrolled([10, 40, 80]).isCollapsed)
    }

    func testSmallDownwardMovesDoNotCollapse() {
        XCTAssertFalse(scrolled([10, 20, 30]).isCollapsed)
    }

    func testScrollingBackUpPastTheThresholdExpands() {
        XCTAssertFalse(scrolled([10, 80, 200, 170]).isCollapsed)
    }

    func testReachingTheTopAlwaysExpands() {
        XCTAssertFalse(scrolled([10, 80, 200, 4]).isCollapsed)
    }

    /// Rubber-banding past the end reverses direction by a few points; the bar must hold still.
    func testBottomBounceDoesNotFlap() {
        let state = scrolled([10, 80, 400, 412, 405, 411, 406])
        XCTAssertTrue(state.isCollapsed)
    }

    /// A tap that expands must not be undone by the next few points of downward drift.
    func testExpandThenSmallDriftStaysExpanded() {
        var state = scrolled([10, 80, 200])
        state.expand()
        state.update(offset: 210)
        state.update(offset: 218)
        XCTAssertFalse(state.isCollapsed)
        state.update(offset: 260)
        XCTAssertTrue(state.isCollapsed)
    }

    /// A kept-alive tab returns scrolled to 600; its first sample is where it
    /// already is, not a 600pt scroll, so a 3pt nudge must not collapse the bar.
    func testFirstSampleIsABaselineNotAScroll() {
        XCTAssertFalse(scrolled([600, 597]).isCollapsed)
    }

    /// A fling past the end springs back by more than the threshold; that is
    /// the list settling, not the listener scrolling up.
    func testOverscrollPastTheEndDoesNotExpand() {
        var state = TabBarScrollState()
        for offset in [10.0, 80, 300, 400] {
            state.update(offset: offset, maxOffset: 400)
        }
        XCTAssertTrue(state.isCollapsed)
        state.update(offset: 440, maxOffset: 400)
        state.update(offset: 400, maxOffset: 400)
        XCTAssertTrue(state.isCollapsed)
        state.update(offset: 360, maxOffset: 400)
        XCTAssertFalse(state.isCollapsed)
    }
}
