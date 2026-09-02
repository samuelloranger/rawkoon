@testable import RawkoonKit
import XCTest

final class SettingsDirtyTests: XCTestCase {
    func testCleanWhenEqualAndNoSecret() {
        XCTAssertFalse(SettingsDirty.isDirty(loaded: "a", draft: "a", secretEntered: false))
    }

    func testDirtyWhenValueChanged() {
        XCTAssertTrue(SettingsDirty.isDirty(loaded: "a", draft: "b", secretEntered: false))
    }

    func testDirtyWhenSecretEnteredEvenIfEqual() {
        XCTAssertTrue(SettingsDirty.isDirty(loaded: "a", draft: "a", secretEntered: true))
    }
}
