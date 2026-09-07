@testable import RawkoonKit
import XCTest

final class SmartRewindTests: XCTestCase {
    func testVeryShortPauseRewindsNothing() {
        XCTAssertEqual(smartRewindOffset(pausedFor: 0), 0)
        XCTAssertEqual(smartRewindOffset(pausedFor: 1), 0)
        XCTAssertEqual(smartRewindOffset(pausedFor: 2.99), 0)
    }

    /// A short navigation prompt or quick question — the reported case that got
    /// no rewind under the old 10s floor.
    func testShortPromptRewindsThreeSeconds() {
        XCTAssertEqual(smartRewindOffset(pausedFor: 3), 3)
        XCTAssertEqual(smartRewindOffset(pausedFor: 5), 3)
        XCTAssertEqual(smartRewindOffset(pausedFor: 14.9), 3)
    }

    func testUnderFiveMinutesRewindsSixSeconds() {
        XCTAssertEqual(smartRewindOffset(pausedFor: 15), 6)
        XCTAssertEqual(smartRewindOffset(pausedFor: 299), 6)
    }

    func testUnderAnHourRewindsTenSeconds() {
        XCTAssertEqual(smartRewindOffset(pausedFor: 300), 10)
        XCTAssertEqual(smartRewindOffset(pausedFor: 3599), 10)
    }

    func testOvernightRewindsTwentySeconds() {
        XCTAssertEqual(smartRewindOffset(pausedFor: 3600), 20)
        XCTAssertEqual(smartRewindOffset(pausedFor: 60 * 60 * 9), 20)
    }

    /// A clock that jumped backwards, or an uninitialised timestamp, must not
    /// produce a negative rewind — that would seek forwards past the pause.
    func testNonsensicalDurationsRewindNothing() {
        XCTAssertEqual(smartRewindOffset(pausedFor: -5), 0)
        XCTAssertEqual(smartRewindOffset(pausedFor: .nan), 0)
        XCTAssertEqual(smartRewindOffset(pausedFor: .infinity), 0)
    }
}
