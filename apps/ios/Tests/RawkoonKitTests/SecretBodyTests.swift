@testable import RawkoonKit
import XCTest

final class SecretBodyTests: XCTestCase {
    func testOmitsEmptySecret() {
        let body = SecretBody.merge(base: ["enabled": .bool(true)], secret: "api_key", value: "")
        XCTAssertNil(body["api_key"])
        XCTAssertEqual(body["enabled"], .bool(true))
    }

    func testIncludesNonEmptySecret() {
        let body = SecretBody.merge(base: ["enabled": .bool(true)], secret: "api_key", value: "sk-123")
        XCTAssertEqual(body["api_key"], .string("sk-123"))
    }
}
