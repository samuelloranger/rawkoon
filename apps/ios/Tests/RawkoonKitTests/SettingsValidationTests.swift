@testable import RawkoonKit
import XCTest

final class SettingsValidationTests: XCTestCase {
    func testClampsIntoRange() {
        XCTAssertEqual(SettingsValidation.clamp(150, to: 0 ... 100), 100)
        XCTAssertEqual(SettingsValidation.clamp(-5, to: 0 ... 100), 0)
        XCTAssertEqual(SettingsValidation.clamp(50, to: 0 ... 100), 50)
    }

    func testEnforcesMinSelection() {
        XCTAssertTrue(SettingsValidation.hasMinSelection(Set(["en"]), min: 1))
        XCTAssertFalse(SettingsValidation.hasMinSelection(Set<String>(), min: 1))
    }

    func testDetectsBlank() {
        XCTAssertFalse(SettingsValidation.nonBlank("  "))
        XCTAssertTrue(SettingsValidation.nonBlank(" x "))
    }
}
