import XCTest
@testable import RawkoonKit

final class SmokeTests: XCTestCase {
    func testTargetBuilds() {
        XCTAssertEqual(RawkoonKit.name, "RawkoonKit")
    }
}
