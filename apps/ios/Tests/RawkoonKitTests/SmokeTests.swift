@testable import RawkoonKit
import XCTest

final class SmokeTests: XCTestCase {
    func testTargetBuilds() {
        XCTAssertEqual(RawkoonKit.name, "RawkoonKit")
    }
}
