@testable import RawkoonKit
import XCTest

final class ConditionRulesTests: XCTestCase {
    func testRegexTypeAllowsMatchesOnly() {
        XCTAssertEqual(ConditionRules.operators(for: "title_regex"), ["matches"])
    }

    func testNumericTypeAllowsComparators() {
        XCTAssertTrue(ConditionRules.operators(for: "seeders").contains("between"))
        XCTAssertTrue(ConditionRules.operators(for: "seeders").contains("gte"))
    }

    func testBooleanFlagNeedsNoValue() {
        XCTAssertFalse(ConditionRules.needsValue("is_true"))
        XCTAssertTrue(ConditionRules.needsValue("equals"))
    }

    func testUnknownTypeReturnsEmpty() {
        XCTAssertTrue(ConditionRules.operators(for: "nonsense").isEmpty)
    }
}
