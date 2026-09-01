@testable import RawkoonKit
import XCTest

final class SmartRewindTests: XCTestCase {
    func testShortPauseRewindsNothing() {
        XCTAssertEqual(smartRewindOffset(pausedFor: 0), 0)
        XCTAssertEqual(smartRewindOffset(pausedFor: 3), 0)
        XCTAssertEqual(smartRewindOffset(pausedFor: 9.99), 0)
    }

    func testUnderAMinuteRewindsTwoSeconds() {
        XCTAssertEqual(smartRewindOffset(pausedFor: 10), 2)
        XCTAssertEqual(smartRewindOffset(pausedFor: 59.9), 2)
    }

    func testUnderAnHourRewindsTenSeconds() {
        XCTAssertEqual(smartRewindOffset(pausedFor: 60), 10)
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
